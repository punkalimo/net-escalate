import { useEffect, useMemo, useRef, useState } from "react";
import {
  Network, RefreshCw, X, ZoomIn, ZoomOut, Search, Router, Server, Shield,
  Monitor, Cable, Route, ScanLine, Gauge, CircleDot, Activity, Clock3,
  Maximize2, Move
} from "lucide-react";
import { discoverTopology, discoverDevicePath, getDevices } from "../services/api";

const TYPE_ICON = { router: Router, switch: Network, firewall: Shield, server: Server, "access-point": Network, printer: Monitor, other: Server, "unknown-hop": Route };
const TYPE_TONE = { router: "#3b82f6", switch: "#a855f7", firewall: "#f97316", server: "#10b981", "access-point": "#06b6d4", printer: "#eab308", other: "#64748b", "unknown-hop": "#64748b" };
const STATUS_TONE = { UP: "#34d399", DOWN: "#f87171", DEGRADED: "#fb923c", UNKNOWN: "#facc15" };

function layoutNodes(nodes, edges) {
  const connected = new Set(edges.flatMap(e => [e.source, e.target]));
  const roots = nodes.filter(n => n.deviceType === "firewall" || n.deviceType === "router");
  const start = roots.length ? roots : nodes.filter(n => connected.has(n.id));
  const order = [...start, ...nodes.filter(n => !start.some(x => x.id === n.id))];
  const positions = new Map();
  const levels = new Map();
  order.forEach(node => {
    const level = node.deviceType === "firewall" ? 0 : node.deviceType === "router" ? 1 : node.deviceType === "switch" ? 2 : 3;
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(node);
  });
  [...levels.entries()].sort((a, b) => a[0] - b[0]).forEach(([level, group]) => {
    const y = 130 + level * 190;
    const gap = 1400 / (group.length + 1);
    group.forEach((node, index) => positions.set(node.id, { x: gap * (index + 1), y }));
  });
  nodes.forEach((node, index) => {
    if (!positions.has(node.id)) positions.set(node.id, { x: 100 + (index % 5) * 260, y: 700 + Math.floor(index / 5) * 180 });
  });
  return positions;
}

function useSvgPanZoom(width, height) {
  const svgRef = useRef(null);
  const drag = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });

  const clamp = value => Math.max(0.45, Math.min(2.5, value));

  function pointInSvg(clientX, clientY) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: width / 2, y: height / 2 };
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height
    };
  }

  function zoomAt(factor, clientX, clientY) {
    setView(current => {
      const point = pointInSvg(clientX, clientY);
      const nextScale = clamp(current.scale * factor);
      if (nextScale === current.scale) return current;
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: point.x - (point.x - current.x) * ratio,
        y: point.y - (point.y - current.y) * ratio
      };
    });
  }

  function zoomCenter(factor) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function reset() { setView({ x: 0, y: 0, scale: 1 }); }

  function fit() {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return reset();
    const next = Math.min(1, Math.max(0.45, Math.min(rect.width / width, rect.height / height) * 0.92));
    setView({ x: (width - width / next) / 2, y: (height - height / next) / 2, scale: next });
  }

  function onWheel(event) {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((event.clientX - drag.current.x) / rect.width) * width / view.scale;
    const dy = ((event.clientY - drag.current.y) / rect.height) * height / view.scale;
    setView(current => ({ ...current, x: drag.current.viewX + dx, y: drag.current.viewY + dy }));
  }

  function onPointerUp() { drag.current = null; }

  return { svgRef, view, zoomCenter, reset, fit, onWheel, onPointerDown, onPointerMove, onPointerUp };
}

function CanvasControls({ view, zoomCenter, reset, fit }) {
  return <div className="absolute left-4 top-4 z-20 flex items-center gap-1 rounded-xl border border-slate-700/80 bg-[#07101c]/95 p-1.5 shadow-xl backdrop-blur-xl">
    <button title="Zoom in" onClick={() => zoomCenter(1.2)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><ZoomIn size={16}/></button>
    <button title="Zoom out" onClick={() => zoomCenter(0.83)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><ZoomOut size={16}/></button>
    <button title="Fit canvas" onClick={fit} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><Maximize2 size={16}/></button>
    <button title="Reset view" onClick={reset} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><RefreshCw size={15}/></button>
    <span className="mx-1 min-w-[48px] border-l border-slate-700 pl-3 text-center font-mono text-[10px] text-slate-500">{Math.round(view.scale * 100)}%</span>
    <span className="hidden items-center gap-1 border-l border-slate-700 pl-3 pr-1 text-[9px] text-slate-600 md:flex"><Move size={12}/> Drag</span>
  </div>;
}

function NodeCard({ node, position, selected, onSelect }) {
  const Icon = TYPE_ICON[node.deviceType] || Server;
  const typeTone = TYPE_TONE[node.deviceType] || TYPE_TONE.other;
  const statusTone = STATUS_TONE[node.status] || STATUS_TONE.UNKNOWN;
  return <g transform={`translate(${position.x - 105},${position.y - 52})`} onClick={() => onSelect(node.id)} className="cursor-pointer">
    <rect width="210" height="104" rx="16" fill="#0b1220" stroke={selected ? "#60a5fa" : "#263449"} strokeWidth={selected ? 2.5 : 1.2}/>
    <rect x="1" y="1" width="208" height="5" rx="4" fill={typeTone}/>
    <circle cx="25" cy="29" r="14" fill={`${typeTone}22`} stroke={`${typeTone}55`}/>
    <foreignObject x="14" y="18" width="22" height="22"><Icon size={20} color={typeTone}/></foreignObject>
    <circle cx="187" cy="24" r="5" fill={statusTone}/>
    <text x="48" y="28" fill="#f8fafc" fontSize="14" fontWeight="700">{String(node.hostname || node.label).slice(0, 23)}</text>
    <text x="16" y="55" fill="#94a3b8" fontSize="11">{node.ipAddress || "No IP"}</text>
    <text x="16" y="73" fill="#64748b" fontSize="10">{String(node.vendor || node.deviceType || "device").slice(0, 28)}</text>
    <text x="16" y="90" fill={statusTone} fontSize="9" fontWeight="700">{node.status || "UNKNOWN"}</text>
  </g>;
}

function TopologyCanvas({ topology, selectedId, setSelectedId }) {
  const positions = useMemo(() => layoutNodes(topology.nodes || [], topology.edges || []), [topology.nodes, topology.edges]);
  const selected = topology.nodes.find(n => n.id === selectedId);
  const panZoom = useSvgPanZoom(1400, 920);
  return <div className="relative min-h-[620px] overflow-hidden rounded-2xl border border-slate-800 bg-[#060b14]" style={{ backgroundImage: "radial-gradient(circle at 50% 20%, rgba(59,130,246,.10), transparent 36%), linear-gradient(rgba(51,65,85,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(51,65,85,.12) 1px, transparent 1px)", backgroundSize: "auto, 32px 32px, 32px 32px" }} onWheel={panZoom.onWheel} onPointerDown={panZoom.onPointerDown} onPointerMove={panZoom.onPointerMove} onPointerUp={panZoom.onPointerUp} onPointerCancel={panZoom.onPointerUp}>
    <CanvasControls {...panZoom}/>
    <svg ref={panZoom.svgRef} viewBox="0 0 1400 920" className="h-full min-h-[620px] w-full select-none touch-none cursor-grab active:cursor-grabbing">
      <g transform={`translate(${panZoom.view.x} ${panZoom.view.y}) scale(${panZoom.view.scale})`}>
        <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {topology.edges.map(edge => {
          const a = positions.get(edge.source), b = positions.get(edge.target); if (!a || !b) return null;
          const midY = (a.y + b.y) / 2;
          const tone = STATUS_TONE[edge.state] || "#475569";
          return <g key={edge.id}>
            <path d={`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`} fill="none" stroke="#111c2e" strokeWidth="8"/>
            <path d={`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`} fill="none" stroke={tone} strokeWidth="2.2" strokeDasharray={edge.state === "DOWN" ? "7 7" : undefined} filter={edge.state === "UP" ? "url(#glow)" : undefined}/>
            <rect x={(a.x+b.x)/2-72} y={midY-12} width="144" height="24" rx="12" fill="#070d18" stroke="#1e293b"/>
            <text x={(a.x+b.x)/2} y={midY+3} textAnchor="middle" fill="#94a3b8" fontSize="9">{edge.sourceInterface || "link"} {edge.targetInterface ? `↔ ${edge.targetInterface}` : ""}</text>
          </g>;
        })}
        {topology.nodes.map(node => <NodeCard key={node.id} node={node} position={positions.get(node.id)} selected={selectedId === node.id} onSelect={setSelectedId}/>) }
      </g>
    </svg>
    {selected && <div className="absolute bottom-4 right-4 w-72 rounded-xl border border-blue-500/20 bg-[#0a111d]/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-blue-400">Selected device</p><h4 className="mt-1 font-semibold text-white">{selected.hostname}</h4></div><button onClick={()=>setSelectedId(null)} className="text-slate-600 hover:text-white"><X size={15}/></button></div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><span className="text-slate-600">IP</span><p className="mt-1 text-slate-300">{selected.ipAddress}</p></div><div><span className="text-slate-600">Status</span><p className="mt-1" style={{color:STATUS_TONE[selected.status]}}>{selected.status}</p></div><div><span className="text-slate-600">Vendor</span><p className="mt-1 text-slate-300">{selected.vendor || "—"}</p></div><div><span className="text-slate-600">Model</span><p className="mt-1 text-slate-300">{selected.model || "—"}</p></div></div>
    </div>}
  </div>;
}

function PathCanvas({ path, selectedId, setSelectedId }) {
  const nodes = path?.nodes || [];
  const edges = path?.edges || [];
  const selected = nodes.find(node => node.id === selectedId);
  const width = Math.max(1100, nodes.length * 250);
  const height = 560;
  const positions = new Map(nodes.map((node, index) => [node.id, { x: 125 + index * 235, y: 260 }]));
  const panZoom = useSvgPanZoom(width, height);
  return <div className="relative min-h-[560px] overflow-hidden rounded-2xl border border-slate-800 bg-[#050a12]" style={{backgroundImage:"radial-gradient(circle at 50% 35%, rgba(14,165,233,.12), transparent 38%), linear-gradient(rgba(51,65,85,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(51,65,85,.10) 1px, transparent 1px)",backgroundSize:"auto, 32px 32px, 32px 32px"}} onWheel={panZoom.onWheel} onPointerDown={panZoom.onPointerDown} onPointerMove={panZoom.onPointerMove} onPointerUp={panZoom.onPointerUp} onPointerCancel={panZoom.onPointerUp}>
    <CanvasControls {...panZoom}/>
    <svg ref={panZoom.svgRef} viewBox={`0 0 ${width} ${height}`} className="h-full min-h-[560px] w-full select-none touch-none cursor-grab active:cursor-grabbing">
      <g transform={`translate(${panZoom.view.x} ${panZoom.view.y}) scale(${panZoom.view.scale})`}>
        <defs><filter id="pathGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <text x="40" y="48" fill="#64748b" fontSize="10" letterSpacing="2">TRACEROUTE PATH · {nodes.length} OBSERVED NODES</text>
        {edges.map(edge => {
          const a = positions.get(edge.source), b = positions.get(edge.target); if (!a || !b) return null;
          return <g key={edge.id}>
            <line x1={a.x+75} y1={a.y} x2={b.x-75} y2={b.y} stroke="#0f2438" strokeWidth="10"/>
            <line x1={a.x+75} y1={a.y} x2={b.x-75} y2={b.y} stroke="#38bdf8" strokeWidth="2" filter="url(#pathGlow)"/>
            <rect x={(a.x+b.x)/2-38} y={a.y-34} width="76" height="22" rx="11" fill="#07111d" stroke="#164e63"/>
            <text x={(a.x+b.x)/2} y={a.y-19} textAnchor="middle" fill="#7dd3fc" fontSize="9">{edge.label}</text>
          </g>;
        })}
        {nodes.map((node, index) => {
          const p = positions.get(node.id); const isTarget = node.role === "TARGET"; const tone = isTarget ? "#60a5fa" : node.role === "REGISTERED_DEVICE" ? "#34d399" : "#64748b";
          const Icon = TYPE_ICON[node.deviceType] || Route;
          return <g key={node.id} transform={`translate(${p.x-75},${p.y-58})`} onClick={()=>setSelectedId(node.id)} className="cursor-pointer">
            <rect width="150" height="116" rx="18" fill="#0b1220" stroke={selectedId===node.id?"#f8fafc":tone} strokeWidth={selectedId===node.id?2.5:1.4}/>
            <circle cx="75" cy="31" r="20" fill={`${tone}18`} stroke={`${tone}55`}/>
            <foreignObject x="63" y="19" width="24" height="24"><Icon size={22} color={tone}/></foreignObject>
            <text x="75" y="72" textAnchor="middle" fill="#f8fafc" fontSize="12" fontWeight="700">{String(node.hostname || node.label).slice(0, 20)}</text>
            <text x="75" y="89" textAnchor="middle" fill="#94a3b8" fontSize="10">{node.ipAddress}</text>
            <text x="75" y="104" textAnchor="middle" fill={tone} fontSize="8" fontWeight="700">{isTarget ? "TARGET" : node.role === "REGISTERED_DEVICE" ? "REGISTERED" : `HOP ${node.hop || index+1}`}</text>
          </g>;
        })}
      </g>
    </svg>
    {selected && <div className="absolute bottom-4 right-4 w-72 rounded-xl border border-sky-500/20 bg-[#09111d]/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between"><div><p className="text-[10px] uppercase tracking-widest text-sky-400">Path node</p><h4 className="mt-1 font-semibold text-white">{selected.hostname}</h4></div><button onClick={()=>setSelectedId(null)} className="text-slate-600 hover:text-white"><X size={15}/></button></div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><span className="text-slate-600">Address</span><p className="mt-1 text-slate-300">{selected.ipAddress}</p></div><div><span className="text-slate-600">Latency</span><p className="mt-1 text-slate-300">{selected.rttMs == null ? "—" : `${selected.rttMs.toFixed(1)} ms`}</p></div><div><span className="text-slate-600">Role</span><p className="mt-1 text-slate-300">{selected.role?.replaceAll("_", " ")}</p></div><div><span className="text-slate-600">Status</span><p className="mt-1" style={{color:STATUS_TONE[selected.status] || "#94a3b8"}}>{selected.status}</p></div></div>
    </div>}
  </div>;
}

function ScanBadge({ label, status }) {
  const tone = status === "COMPLETE" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : status === "NOT_INSTALLED" ? "text-amber-400 bg-amber-400/10 border-amber-400/20" : "text-slate-400 bg-slate-400/10 border-slate-400/20";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{label}: {String(status || "UNKNOWN").replaceAll("_", " ")}</span>;
}

function NmapPanel({ nmap }) {
  const ports = nmap?.openPorts || [];
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ScanLine size={17} className="text-fuchsia-400"/><h3 className="font-semibold text-white">Nmap fingerprint</h3></div><p className="mt-1 text-xs text-slate-600">Service exposure and OS/device fingerprinting for the selected target.</p></div><ScanBadge label="Nmap" status={nmap?.status}/></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"><p className="text-[10px] uppercase text-slate-600">Device type</p><p className="mt-1 text-sm text-slate-300">{nmap?.deviceType || "Not fingerprinted"}</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"><p className="text-[10px] uppercase text-slate-600">OS / platform</p><p className="mt-1 truncate text-sm text-slate-300" title={nmap?.osDetails || nmap?.running || "—"}>{nmap?.osDetails || nmap?.running || "Not fingerprinted"}</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"><p className="text-[10px] uppercase text-slate-600">Open ports</p><p className="mt-1 text-sm font-semibold text-white">{ports.length}</p></div></div>
    {ports.length ? <div className="mt-4 overflow-hidden rounded-xl border border-slate-800"><div className="grid grid-cols-[80px_80px_1fr_1fr] bg-slate-900 px-3 py-2 text-[10px] uppercase tracking-wide text-slate-600"><span>Port</span><span>Proto</span><span>Service</span><span>Version</span></div>{ports.map(item=><div key={`${item.port}-${item.protocol}`} className="grid grid-cols-[80px_80px_1fr_1fr] border-t border-slate-800 px-3 py-2 text-xs"><span className="font-mono text-emerald-400">{item.port}</span><span className="uppercase text-slate-500">{item.protocol}</span><span className="text-slate-300">{item.service}</span><span className="truncate text-slate-500">{item.version || "—"}</span></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-600">No open ports reported by this scan.</div>}
    {nmap?.error && <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400">{nmap.error}</div>}
  </div>;
}

function PathSummary({ path }) {
  const hops = path?.traceroute?.hops || [];
  const target = path?.target;
  const maxRtt = hops.reduce((max, hop) => Math.max(max, hop.rttMs || 0), 0);
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-600"><Route size={14}/>Hops observed</div><p className="mt-2 text-2xl font-bold text-white">{hops.length}</p></div>
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-600"><Gauge size={14}/>Peak hop latency</div><p className="mt-2 text-2xl font-bold text-white">{maxRtt ? `${maxRtt.toFixed(1)} ms` : "—"}</p></div>
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-600"><ScanLine size={14}/>Nmap ports</div><p className="mt-2 text-2xl font-bold text-white">{path?.nmap?.openPorts?.length || 0}</p></div>
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs text-slate-600"><CircleDot size={14}/>Target state</div><p className="mt-2 text-sm font-bold" style={{color:STATUS_TONE[target?.status] || "#94a3b8"}}>{target?.status || "UNKNOWN"}</p><p className="mt-1 truncate text-[10px] text-slate-600">{target?.ipAddress}</p></div>
  </div>;
}

export default function TopologyView() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("fleet");
  const [loading, setLoading] = useState(false);
  const [pathLoading, setPathLoading] = useState(false);
  const [error, setError] = useState("");
  const [topology, setTopology] = useState(null);
  const [path, setPath] = useState(null);
  const [devices, setDevices] = useState([]);
  const [targetDeviceId, setTargetDeviceId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  async function discover() {
    setLoading(true); setError("");
    try { const result = await discoverTopology(); if (!result.success) throw new Error(result.message || "Topology discovery failed"); setTopology(result); }
    catch (e) { setError(e.response?.data?.message || e.message || "Topology discovery failed."); }
    finally { setLoading(false); }
  }

  async function loadDevices() {
    try { const result = await getDevices(); if (result.success) { setDevices(result.devices || []); if (!targetDeviceId && result.devices?.length) setTargetDeviceId(result.devices[0].deviceId); } }
    catch (e) { setError(e.response?.data?.message || e.message || "Unable to load devices."); }
  }

  async function discoverPath() {
    if (!targetDeviceId) return;
    setPathLoading(true); setError(""); setSelectedId(null);
    try { const result = await discoverDevicePath(targetDeviceId); if (!result.success) throw new Error(result.message || "Device path discovery failed"); setPath(result); }
    catch (e) { setError(e.response?.data?.message || e.message || "Device path discovery failed."); }
    finally { setPathLoading(false); }
  }

  useEffect(() => { if (open) { loadDevices(); if (!topology) discover(); } }, [open]);
  const filtered = useMemo(() => {
    if (!topology) return null;
    const q = query.trim().toLowerCase();
    if (!q) return topology;
    const nodes = topology.nodes.filter(n => `${n.hostname} ${n.ipAddress} ${n.vendor} ${n.deviceType}`.toLowerCase().includes(q));
    const ids = new Set(nodes.map(n => n.id));
    return { ...topology, nodes, edges: topology.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
  }, [topology, query]);

  return <>
    <button onClick={()=>setOpen(true)} className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-blue-900/40 transition hover:-translate-y-0.5 hover:bg-blue-500"><Network size={17}/>Topology</button>
    {open && <div className="fixed inset-0 z-[60] bg-[#03060b]/95 p-3 backdrop-blur-md sm:p-5">
      <div className="mx-auto flex h-full max-w-[1850px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#070c15] shadow-2xl">
        <header className="border-b border-slate-800 bg-[#08101c]/95 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3"><div className="relative rounded-xl border border-blue-400/20 bg-blue-500/10 p-2.5 text-blue-400"><Network size={21}/><span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400"/></div><div><h1 className="font-bold tracking-wide text-white">Network Topology</h1><p className="text-[10px] uppercase tracking-[.18em] text-slate-600">Discover · trace · fingerprint · troubleshoot</p></div></div>
            <div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1"><button onClick={()=>setMode("fleet")} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold ${mode==="fleet"?"bg-slate-800 text-white":"text-slate-500 hover:text-white"}`}><Network size={14}/>Fleet map</button><button onClick={()=>{setMode("path");loadDevices();}} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold ${mode==="path"?"bg-blue-600 text-white":"text-slate-500 hover:text-white"}`}><Route size={14}/>Device path</button></div>{mode==="fleet"&&<div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter devices..." className="form-input w-48 py-2 pl-8"/></div>}{mode==="fleet"&&<button onClick={discover} disabled={loading} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><RefreshCw size={14} className={loading?"animate-spin":""}/>{loading?"Discovering":"Rediscover"}</button>}<button onClick={()=>setOpen(false)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><X size={18}/></button></div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="w-full shrink-0 border-b border-slate-800 p-4 lg:w-72 lg:border-b-0 lg:border-r">
            {mode === "fleet" ? <><div className="grid grid-cols-3 gap-2"><div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"><p className="text-[9px] uppercase text-slate-600">Devices</p><p className="mt-1 text-xl font-bold text-white">{topology?.nodes?.length || 0}</p></div><div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"><p className="text-[9px] uppercase text-slate-600">Links</p><p className="mt-1 text-xl font-bold text-white">{topology?.edges?.length || 0}</p></div><div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"><p className="text-[9px] uppercase text-slate-600">Down</p><p className="mt-1 text-xl font-bold text-red-400">{topology?.nodes?.filter(n=>n.status==="DOWN").length || 0}</p></div></div><div className="mt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-600">Live legend</p>{[["UP","Online",STATUS_TONE.UP],["DEGRADED","Warning",STATUS_TONE.DEGRADED],["DOWN","Offline",STATUS_TONE.DOWN],["UNKNOWN","Unknown",STATUS_TONE.UNKNOWN]].map(([k,label,c])=><div key={k} className="mb-2 flex items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 rounded-full" style={{background:c}}/>{label}</div>)}</div><div className="mt-6 rounded-xl border border-blue-500/10 bg-blue-500/5 p-3 text-xs leading-5 text-slate-500"><Cable size={15} className="mb-2 text-blue-400"/>CDP and LLDP links are shown when a neighbor can be correlated with a registered NetEscalate device.</div></> : <>
              <div className="rounded-2xl border border-sky-500/10 bg-sky-500/5 p-4"><div className="flex items-center gap-2"><Route size={17} className="text-sky-400"/><p className="text-sm font-semibold text-white">Trace one device</p></div><p className="mt-2 text-xs leading-5 text-slate-500">Traceroute draws the actual route toward the selected device. Nmap then fingerprints only that target.</p><label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-slate-600">Target device</label><select value={targetDeviceId} onChange={e=>setTargetDeviceId(e.target.value)} className="form-input mt-2 w-full">{devices.map(device=><option key={device.deviceId} value={device.deviceId}>{device.hostname} — {device.ipAddress}</option>)}</select><button onClick={discoverPath} disabled={!targetDeviceId || pathLoading} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-sky-900/20 hover:bg-sky-500 disabled:opacity-50"><Activity size={14} className={pathLoading?"animate-pulse":""}/>{pathLoading?"Tracing + scanning...":"Trace & fingerprint"}</button></div>
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><Gauge size={14} className="text-emerald-400"/>What the path view tells you</div><ul className="mt-2 space-y-2 text-[11px] leading-4 text-slate-600"><li>• Where latency begins to increase.</li><li>• Which registered device appears in the route.</li><li>• Target OS/device fingerprint from Nmap.</li><li>• Exposed TCP/UDP services on the target.</li></ul></div>
            </>}
            {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{error}</div>}
          </aside>

          <main className="min-h-0 flex-1 overflow-auto p-4">
            {mode === "fleet" ? <div>{loading && !filtered ? <div className="flex min-h-[620px] items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={17}/>Discovering topology via SNMP...</div> : filtered ? <TopologyCanvas topology={filtered} selectedId={selectedId} setSelectedId={setSelectedId}/> : <div className="flex min-h-[620px] items-center justify-center text-slate-600">No topology data.</div>}</div> : <div className="space-y-4">
              {!path && !pathLoading && <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 text-center"><div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4 text-sky-400"><Route size={28}/></div><h2 className="mt-4 text-lg font-semibold text-white">Trace a device path</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-600">Select a registered device and run a targeted traceroute + Nmap probe. The canvas will draw each observed routing hop and label the registered target.</p></div>}
              {pathLoading && <div className="flex min-h-[560px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/30"><RefreshCw size={28} className="animate-spin text-sky-400"/><p className="mt-4 text-sm font-semibold text-white">Building device path</p><p className="mt-1 text-xs text-slate-600">Running traceroute and Nmap against the selected target…</p></div>}
              {path && !pathLoading && <><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-sm font-semibold text-white">{path.target?.hostname}</p><span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-500">{path.target?.ipAddress}</span></div><p className="mt-1 text-xs text-slate-600">Targeted path analysis · {new Date(path.generatedAt).toLocaleString()}</p></div><div className="flex items-center gap-2"><ScanBadge label="Traceroute" status={path.method?.traceroute}/><ScanBadge label="Nmap" status={path.method?.nmap}/></div></div><PathSummary path={path}/><PathCanvas path={path} selectedId={selectedId} setSelectedId={setSelectedId}/><div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]"><NmapPanel nmap={path.nmap}/><div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5"><div className="flex items-center gap-2"><Clock3 size={17} className="text-sky-400"/><h3 className="font-semibold text-white">Traceroute evidence</h3></div><div className="mt-4 space-y-2">{(path.traceroute?.hops || []).map(hop=><div key={`${hop.hop}-${hop.ip}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs"><span className="text-slate-500">Hop {hop.hop}</span><span className="font-mono text-slate-300">{hop.ip || "* * *"}</span><span className="text-sky-400">{hop.rttMs == null ? "—" : `${hop.rttMs.toFixed(1)} ms`}</span></div>)}</div>{path.traceroute?.error && <p className="mt-3 rounded-lg bg-amber-500/5 p-3 text-xs text-amber-400">{path.traceroute.error}</p>}{path.warnings?.map(warning=><p key={warning} className="mt-3 rounded-lg border border-amber-500/10 bg-amber-500/5 p-3 text-xs text-amber-400">{warning}</p>)}</div></div></>}
            </div>}
          </main>
        </div>
        {mode === "fleet" && topology?.diagnostics?.length>0 && <footer className="border-t border-slate-800 px-5 py-3"><div className="flex items-center gap-4 overflow-x-auto text-[10px] text-slate-600">{topology.diagnostics.map(d=><span key={d.deviceId} className="whitespace-nowrap"><span className={d.status==="OK"?"text-emerald-400":"text-yellow-400"}>{d.status}</span> {d.hostname} · CDP {d.cdp||0} · LLDP {d.lldp||0}</span>)}</div></footer>}
      </div>
    </div>}
  </>;
}
