import { useEffect, useMemo, useState } from "react";
import { Network, RefreshCw, X, ZoomIn, ZoomOut, Maximize2, Search, Router, Server, Shield, Monitor, AlertTriangle, CheckCircle2, Cable } from "lucide-react";
import { discoverTopology } from "../services/api";

const TYPE_ICON = { router: Router, switch: Network, firewall: Shield, server: Server, "access-point": Network, printer: Monitor, other: Server };
const TYPE_TONE = { router: "#3b82f6", switch: "#a855f7", firewall: "#f97316", server: "#10b981", "access-point": "#06b6d4", printer: "#eab308", other: "#64748b" };
const STATUS_TONE = { UP: "#34d399", DOWN: "#f87171", DEGRADED: "#fb923c", UNKNOWN: "#facc15" };

function layoutNodes(nodes, edges) {
  const connected = new Set(edges.flatMap(e => [e.source, e.target]));
  const roots = nodes.filter(n => n.deviceType === "firewall" || n.deviceType === "router");
  const start = roots.length ? roots : nodes.filter(n => connected.has(n.id));
  const order = [...start, ...nodes.filter(n => !start.some(x => x.id === n.id))];
  const positions = new Map();
  const width = 1400;
  const levels = new Map();
  order.forEach((node, index) => {
    const type = node.deviceType;
    const level = type === "firewall" ? 0 : type === "router" ? 1 : type === "switch" ? 2 : 3;
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(node);
  });
  [...levels.entries()].sort((a,b)=>a[0]-b[0]).forEach(([level, group]) => {
    const y = 130 + level * 190;
    const gap = width / (group.length + 1);
    group.forEach((node, index) => positions.set(node.id, { x: gap * (index + 1), y }));
  });
  nodes.forEach((node, index) => {
    if (!positions.has(node.id)) positions.set(node.id, { x: 100 + (index % 5) * 260, y: 700 + Math.floor(index / 5) * 180 });
  });
  return positions;
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
  return <div className="relative min-h-[620px] overflow-auto rounded-2xl border border-slate-800 bg-[#060b14]" style={{ backgroundImage: "radial-gradient(circle at 50% 20%, rgba(59,130,246,.10), transparent 36%), linear-gradient(rgba(51,65,85,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(51,65,85,.12) 1px, transparent 1px)", backgroundSize: "auto, 32px 32px, 32px 32px" }}>
    <svg viewBox="0 0 1400 920" className="min-h-[620px] min-w-[1000px] w-full">
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
      {topology.nodes.map(node => <NodeCard key={node.id} node={node} position={positions.get(node.id)} selected={selectedId === node.id} onSelect={setSelectedId}/>)}
    </svg>
    {selected && <div className="absolute bottom-4 right-4 w-72 rounded-xl border border-blue-500/20 bg-[#0a111d]/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-blue-400">Selected device</p><h4 className="mt-1 font-semibold text-white">{selected.hostname}</h4></div><button onClick={()=>setSelectedId(null)} className="text-slate-600 hover:text-white"><X size={15}/></button></div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><span className="text-slate-600">IP</span><p className="mt-1 text-slate-300">{selected.ipAddress}</p></div><div><span className="text-slate-600">Status</span><p className="mt-1" style={{color:STATUS_TONE[selected.status]}}>{selected.status}</p></div><div><span className="text-slate-600">Vendor</span><p className="mt-1 text-slate-300">{selected.vendor || "—"}</p></div><div><span className="text-slate-600">Model</span><p className="mt-1 text-slate-300">{selected.model || "—"}</p></div></div>
    </div>}
  </div>;
}

export default function TopologyView() {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [topology, setTopology] = useState(null), [query, setQuery] = useState(""), [selectedId, setSelectedId] = useState(null), [zoom, setZoom] = useState(1);
  async function discover() { setLoading(true); setError(""); try { const result = await discoverTopology(); if (!result.success) throw new Error(result.message || "Topology discovery failed"); setTopology(result); } catch (e) { setError(e.response?.data?.message || e.message || "Topology discovery failed."); } finally { setLoading(false); } }
  useEffect(() => { if (open && !topology) discover(); }, [open]);
  const filtered = useMemo(() => { if (!topology) return null; const q=query.trim().toLowerCase(); if (!q) return topology; const nodes=topology.nodes.filter(n=>`${n.hostname} ${n.ipAddress} ${n.vendor} ${n.deviceType}`.toLowerCase().includes(q)); const ids=new Set(nodes.map(n=>n.id)); return {...topology,nodes,edges:topology.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))}; }, [topology,query]);
  return <>
    <button onClick={()=>setOpen(true)} className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-2xl shadow-blue-900/40 hover:bg-blue-500"><Network size={17}/>Topology</button>
    {open && <div className="fixed inset-0 z-[60] bg-[#03060b]/95 p-3 backdrop-blur-md sm:p-5">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#070c15] shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-600/15 p-2 text-blue-400"><Network size={21}/></div><div><h1 className="font-bold text-white">Network Topology</h1><p className="text-[10px] uppercase tracking-[.18em] text-slate-600">SNMP · CDP · LLDP · live infrastructure map</p></div></div>
          <div className="flex flex-wrap items-center gap-2"><div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter devices..." className="form-input w-52 py-2 pl-8"/></div><button onClick={()=>setZoom(z=>Math.min(1.6,z+.15))} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><ZoomIn size={16}/></button><button onClick={()=>setZoom(z=>Math.max(.65,z-.15))} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><ZoomOut size={16}/></button><button onClick={discover} disabled={loading} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><RefreshCw size={14} className={loading?"animate-spin":""}/>{loading?"Discovering":"Rediscover"}</button><button onClick={()=>setOpen(false)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><X size={18}/></button></div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="w-full border-b border-slate-800 p-4 lg:w-72 lg:border-b-0 lg:border-r"><div className="grid grid-cols-3 gap-2"><div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"><p className="text-[9px] uppercase text-slate-600">Devices</p><p className="mt-1 text-xl font-bold text-white">{topology?.nodes?.length || 0}</p></div><div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"><p className="text-[9px] uppercase text-slate-600">Links</p><p className="mt-1 text-xl font-bold text-white">{topology?.edges?.length || 0}</p></div><div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"><p className="text-[9px] uppercase text-slate-600">Down</p><p className="mt-1 text-xl font-bold text-red-400">{topology?.nodes?.filter(n=>n.status==="DOWN").length || 0}</p></div></div>
            <div className="mt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-600">Legend</p>{[["UP","Online",STATUS_TONE.UP],["DEGRADED","Warning",STATUS_TONE.DEGRADED],["DOWN","Offline",STATUS_TONE.DOWN],["UNKNOWN","Unknown",STATUS_TONE.UNKNOWN]].map(([k,label,c])=><div key={k} className="mb-2 flex items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 rounded-full" style={{background:c}}/>{label}</div>)}</div>
            <div className="mt-6 rounded-xl border border-blue-500/10 bg-blue-500/5 p-3 text-xs leading-5 text-slate-500"><Cable size={15} className="mb-2 text-blue-400"/>Connections are learned from Cisco CDP and standards-based LLDP. A link is drawn only when the neighbor can be matched to a registered NetEscalate device.</div>
            {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{error}</div>}
          </aside>
          <main className="min-h-0 flex-1 overflow-auto p-4" style={{transform:`scale(${zoom})`,transformOrigin:"top left",width:`${100/zoom}%`}}>{loading && !filtered ? <div className="flex h-full items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 animate-spin" size={17}/>Discovering topology via SNMP...</div> : filtered ? <TopologyCanvas topology={filtered} selectedId={selectedId} setSelectedId={setSelectedId}/> : <div className="flex h-full items-center justify-center text-slate-600">No topology data.</div>}</main>
        </div>
        {topology?.diagnostics?.length>0 && <footer className="border-t border-slate-800 px-5 py-3"><div className="flex items-center gap-4 overflow-x-auto text-[10px] text-slate-600">{topology.diagnostics.map(d=><span key={d.deviceId} className="whitespace-nowrap"><span className={d.status==="OK"?"text-emerald-400":"text-yellow-400"}>{d.status}</span> {d.hostname} · CDP {d.cdp||0} · LLDP {d.lldp||0}</span>)}</div></footer>}
      </div>
    </div>}
  </>;
}
