import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Cpu, Filter, Gauge, LayoutDashboard, Menu, Network, Plus, RefreshCw,
  Search, Server, Shield, Signal, Trash2, Wifi, WifiOff, X, Zap
} from "lucide-react";
import {
  getIncidents, resolveIncident, getDevices, createDevice, deleteDevice,
  getTechnicians
} from "./services/api";
import InterfaceHealthCenter from "./components/InterfaceHealthCenter";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const nav = [
  ["overview", "Operations", LayoutDashboard],
  ["incidents", "Incidents", AlertTriangle],
  ["interfaces", "Interface Health", Signal],
  ["devices", "Devices", Server]
];

const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };

function Stat({ label, value, icon: Icon, tone = "blue", hint }) {
  const tones = {
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    red: "text-red-400 bg-red-500/10 border-red-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
  };
  return <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl shadow-black/10">
    <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-blue-500/5 blur-2xl" />
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</p><p className="mt-1 text-xs text-slate-600">{hint}</p></div>
      <div className={`rounded-xl border p-3 ${tones[tone]}`}><Icon size={19}/></div>
    </div>
  </div>;
}

function Badge({ children, kind = "neutral" }) {
  const styles = {
    critical: "border-red-500/30 bg-red-500/10 text-red-400",
    high: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    low: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    active: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    calling: "border-purple-500/30 bg-purple-500/10 text-purple-400",
    acknowledged: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    resolved: "border-slate-700 bg-slate-800/60 text-slate-500",
    down: "border-red-500/30 bg-red-500/10 text-red-400",
    up: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    degraded: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    neutral: "border-slate-700 bg-slate-800/60 text-slate-400"
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${styles[kind] || styles.neutral}`}>{children}</span>;
}

function severityKind(s) { return severityRank[s] == null ? "neutral" : s; }
function statusKind(s) { return ({ OPEN: "active", CALLING: "calling", ESCALATING: "high", ACKNOWLEDGED: "acknowledged", RESOLVED: "resolved", DOWN: "down", UP: "up", DEGRADED: "degraded" }[s] || "neutral"); }

function TechBackdrop() {
  return <svg className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-30" viewBox="0 0 1600 900" preserveAspectRatio="none">
    <defs><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="currentColor" strokeOpacity=".09"/></pattern></defs>
    <rect width="1600" height="900" fill="url(#grid)" className="text-blue-400"/>
    <path d="M0 180 C300 90 430 300 760 180 S1250 80 1600 220" fill="none" stroke="currentColor" strokeOpacity=".08" className="text-cyan-400"/>
    <path d="M0 720 C300 620 520 790 900 650 S1300 580 1600 690" fill="none" stroke="currentColor" strokeOpacity=".06" className="text-blue-500"/>
  </svg>;
}

function Shell({ page, setPage, counts, children }) {
  const [mobile, setMobile] = useState(false);
  return <div className="min-h-screen bg-[#050810] text-slate-200">
    <TechBackdrop/>
    <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-800/80 bg-[#080d16]/95 backdrop-blur-xl transition-transform lg:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 items-center gap-3 border-b border-slate-800/80 px-5"><div className="rounded-xl bg-blue-600 p-2 shadow-lg shadow-blue-600/20"><Network size={19}/></div><div><p className="font-bold tracking-wide text-white">NetEscalate</p><p className="text-[9px] uppercase tracking-[.22em] text-slate-600">NOC intelligence</p></div></div>
      <div className="p-3"><p className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600">Operations</p>{nav.map(([id,label,Icon])=><button key={id} onClick={()=>{setPage(id);setMobile(false)}} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${page===id?"bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20":"text-slate-500 hover:bg-slate-800/50 hover:text-slate-200"}`}><Icon size={17}/><span>{label}</span>{id==="incidents"&&counts.active>0&&<span className="ml-auto rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">{counts.active}</span>}</button>)}</div>
      <div className="absolute bottom-0 left-0 right-0 border-t border-slate-800/80 p-4"><div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-3"><div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"/><span className="text-xs font-semibold text-emerald-400">Monitoring active</span></div><p className="mt-2 text-[10px] leading-4 text-slate-600">SNMP telemetry and incident engine online</p></div></div>
    </aside>
    {mobile&&<button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={()=>setMobile(false)} aria-label="Close menu"/>}
    <div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800/80 bg-[#050810]/85 px-4 backdrop-blur-xl sm:px-6"><div className="flex items-center gap-3"><button onClick={()=>setMobile(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 lg:hidden"><Menu size={20}/></button><div><p className="text-sm font-semibold text-white">{nav.find(n=>n[0]===page)?.[1]}</p><p className="hidden text-[10px] text-slate-600 sm:block">Real-time infrastructure observability</p></div></div><div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1.5 sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"/><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Live telemetry</span></div><div className="rounded-full border border-slate-800 bg-slate-900 p-2"><Cpu size={15} className="text-blue-400"/></div></div></header><main className="mx-auto max-w-[1700px] p-4 sm:p-6">{children}</main></div>
  </div>;
}

function Overview({ incidents, devices, go }) {
  const active = incidents.filter(i=>i.status!=="RESOLVED");
  const critical = active.filter(i=>i.severity==="critical");
  const degraded = devices.filter(d=>d.status==="DEGRADED");
  const offline = devices.filter(d=>d.status==="DOWN");
  const attention = [...active].sort((a,b)=>(severityRank[a.severity]??9)-(severityRank[b.severity]??9)).slice(0,5);
  return <div className="space-y-6">
    <div className="relative overflow-hidden rounded-2xl border border-blue-500/15 bg-gradient-to-br from-blue-950/50 via-slate-900/70 to-slate-950 p-6 sm:p-8"><div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl"/><div className="relative max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.18em] text-blue-400"><Zap size={12}/> Network command center</div><h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Know what needs attention before users do.</h1><p className="mt-3 text-sm leading-6 text-slate-500">A unified view of incidents, device availability and interface performance. Prioritize active faults and investigate slow links without digging through history.</p></div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Active incidents" value={active.length} icon={AlertTriangle} tone={active.length?"amber":"green"} hint="Requiring operator attention"/><Stat label="Critical" value={critical.length} icon={Shield} tone="red" hint="Highest severity"/><Stat label="Degraded links" value={degraded.length} icon={Gauge} tone="amber" hint="Interface health warnings"/><Stat label="Devices offline" value={offline.length} icon={WifiOff} tone="red" hint={`${devices.length} devices monitored`}/></div>
    <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60"><div className="flex items-center justify-between border-b border-slate-800/80 p-5"><div><h2 className="font-semibold text-white">Needs attention</h2><p className="mt-1 text-xs text-slate-600">Highest-priority active conditions</p></div><button onClick={()=>go("incidents")} className="text-xs font-semibold text-blue-400 hover:text-blue-300">View all →</button></div>{attention.length?<div className="divide-y divide-slate-800/70">{attention.map(i=><button key={i.incidentId} onClick={()=>go("incidents")} className="flex w-full items-center gap-4 p-4 text-left hover:bg-slate-800/30"><div className={`h-2 w-2 rounded-full ${i.severity==="critical"?"bg-red-400":"bg-orange-400"}`}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-white">{i.incidentId}</span><Badge kind={severityKind(i.severity)}>{i.severity}</Badge></div><p className="mt-1 truncate text-sm text-slate-300">{i.device} · {i.description}</p></div><Badge kind={statusKind(i.status)}>{i.status}</Badge></button>)}</div>:<div className="p-10 text-center"><CheckCircle2 className="mx-auto text-emerald-400"/><p className="mt-3 text-sm font-medium text-white">All clear</p><p className="mt-1 text-xs text-slate-600">No active incidents require attention.</p></div>}</section>
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Fleet status</h2><p className="mt-1 text-xs text-slate-600">Current device posture</p></div><button onClick={()=>go("devices")} className="text-xs font-semibold text-blue-400">Manage →</button></div><div className="mt-6 space-y-5">{[["Online",devices.filter(d=>d.status==="UP").length,"bg-emerald-400"],["Degraded",degraded.length,"bg-orange-400"],["Offline",offline.length,"bg-red-400"],["Unknown",devices.filter(d=>!d.status||d.status==="UNKNOWN").length,"bg-yellow-400"]].map(([label,value,color])=><div key={label}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-500">{label}</span><span className="font-semibold text-slate-300">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${color}`} style={{width:`${devices.length?Math.min(100,value/devices.length*100):0}%`}}/></div></div>)}</div></section>
    </div>
  </div>;
}

function IncidentCenter({ incidents, reload }) {
  const [query,setQuery]=useState(""); const [status,setStatus]=useState("ACTIVE"); const [severity,setSeverity]=useState("ALL"); const [device,setDevice]=useState("ALL"); const [sort,setSort]=useState("priority"); const [page,setPage]=useState(1); const [busy,setBusy]=useState("");
  const perPage=25;
  const devices=useMemo(()=>[...new Set(incidents.map(i=>i.device).filter(Boolean))].sort(),[incidents]);
  const filtered=useMemo(()=>{let list=incidents.filter(i=>{const q=query.toLowerCase();const text=`${i.incidentId||""} ${i.device||""} ${i.location||""} ${i.description||""} ${i.technician?.name||""}`.toLowerCase();if(q&&!text.includes(q))return false;if(status==="ACTIVE"&&i.status==="RESOLVED")return false;if(status!=="ALL"&&status!=="ACTIVE"&&i.status!==status)return false;if(severity!=="ALL"&&i.severity!==severity)return false;if(device!=="ALL"&&i.device!==device)return false;return true;});list.sort((a,b)=>{if(sort==="priority")return (severityRank[a.severity]??9)-(severityRank[b.severity]??9)||new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0);if(sort==="oldest")return new Date(a.createdAt||0)-new Date(b.createdAt||0);if(sort==="device")return String(a.device).localeCompare(String(b.device));return new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0)});return list},[incidents,query,status,severity,device,sort]);
  useEffect(()=>setPage(1),[query,status,severity,device,sort]); const pages=Math.max(1,Math.ceil(filtered.length/perPage)); const visible=filtered.slice((page-1)*perPage,page*perPage);
  async function resolve(id){setBusy(id);try{await resolveIncident(id);await reload()}finally{setBusy("")}}
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold text-white">Incident command</h1><p className="mt-1 text-sm text-slate-600">Search, prioritize and manage incidents without scrolling through history.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Active" value={incidents.filter(i=>i.status!=="RESOLVED").length} icon={AlertTriangle} tone="amber" hint="Open conditions"/><Stat label="Critical" value={incidents.filter(i=>i.status!=="RESOLVED"&&i.severity==="critical").length} icon={Shield} tone="red" hint="Immediate attention"/><Stat label="Escalating" value={incidents.filter(i=>["CALLING","ESCALATING"].includes(i.status)).length} icon={Signal} tone="blue" hint="Technician workflow"/><Stat label="Resolved" value={incidents.filter(i=>i.status==="RESOLVED").length} icon={CheckCircle2} tone="green" hint="Historical incidents"/></div>
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60"><div className="border-b border-slate-800/80 p-4"><div className="flex flex-col gap-3 lg:flex-row"><div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search ID, device, location, technician..." className="form-input w-full pl-9"/></div><div className="flex flex-wrap gap-2"><select value={status} onChange={e=>setStatus(e.target.value)} className="form-input"><option value="ACTIVE">Active only</option><option value="ALL">All incidents</option><option value="OPEN">Open</option><option value="CALLING">Calling</option><option value="ESCALATING">Escalating</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option></select><select value={severity} onChange={e=>setSeverity(e.target.value)} className="form-input"><option value="ALL">All severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select value={device} onChange={e=>setDevice(e.target.value)} className="form-input"><option value="ALL">All devices</option>{devices.map(d=><option key={d}>{d}</option>)}</select><select value={sort} onChange={e=>setSort(e.target.value)} className="form-input"><option value="priority">Priority</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="device">Device</option></select></div></div><div className="flex items-center gap-2 px-1 pt-3 text-[10px] text-slate-600"><Filter size={12}/>{filtered.length} matching incidents · 25 per page</div></div>
      <div className="hidden grid-cols-[130px_90px_minmax(180px,1fr)_130px_120px_90px] gap-4 border-b border-slate-800/70 px-5 py-3 text-[9px] font-bold uppercase tracking-[.16em] text-slate-600 md:grid"><span>Incident</span><span>Severity</span><span>Device / Description</span><span>Technician</span><span>Status</span><span>Action</span></div>
      {!visible.length?<div className="p-14 text-center"><CheckCircle2 className="mx-auto text-emerald-400"/><p className="mt-3 text-sm font-medium text-white">No matching incidents</p><p className="mt-1 text-xs text-slate-600">Try changing your filters.</p></div>:<div className="divide-y divide-slate-800/70">{visible.map(i=><div key={i.incidentId} className="grid gap-3 px-5 py-4 transition hover:bg-slate-800/20 md:grid-cols-[130px_90px_minmax(180px,1fr)_130px_120px_90px] md:items-center md:gap-4"><div><p className="font-mono text-xs font-semibold text-white">{i.incidentId}</p><p className="mt-1 text-[10px] text-slate-600">{i.createdAt?new Date(i.createdAt).toLocaleString():"—"}</p></div><div><Badge kind={severityKind(i.severity)}>{i.severity}</Badge></div><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-300">{i.device}</p><p className="mt-1 truncate text-xs text-slate-600">{i.description}</p></div><div className="text-xs text-slate-400">{i.technician?.name||"Unassigned"}</div><div><Badge kind={statusKind(i.status)}>{i.status}</Badge></div><div>{i.status!=="RESOLVED"?<button disabled={busy===i.incidentId} onClick={()=>resolve(i.incidentId)} className="rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">{busy===i.incidentId?"...":"Resolve"}</button>:<span className="text-[10px] text-slate-700">Closed</span>}</div></div>)}</div>}
      <div className="flex flex-col gap-3 border-t border-slate-800/70 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-600">Showing {filtered.length?((page-1)*perPage+1):0}–{Math.min(page*perPage,filtered.length)} of {filtered.length}</p><div className="flex items-center gap-2"><button disabled={page===1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border border-slate-700 p-2 disabled:opacity-30"><ChevronLeft size={15}/></button><span className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400">{page} / {pages}</span><button disabled={page===pages} onClick={()=>setPage(p=>p+1)} className="rounded-lg border border-slate-700 p-2 disabled:opacity-30"><ChevronRight size={15}/></button></div></div>
    </section>
  </div>;
}

function Devices({ devices, reload }) {
  const [showAdd,setShowAdd]=useState(false); const [form,setForm]=useState({hostname:"",ipAddress:"",deviceType:"router",vendor:"",pollingInterval:30,community:"public"}); const [busy,setBusy]=useState(false);
  async function add(e){e.preventDefault();setBusy(true);try{await createDevice({...form,pollingInterval:Number(form.pollingInterval),monitoringEnabled:true,snmp:{enabled:true,version:"2c",community:form.community}});setShowAdd(false);setForm({hostname:"",ipAddress:"",deviceType:"router",vendor:"",pollingInterval:30,community:"public"});await reload()}catch(err){alert(err.response?.data?.message||err.message)}finally{setBusy(false)}}
  async function remove(d){if(!confirm(`Delete ${d.hostname}?`))return;await deleteDevice(d.deviceId);await reload()}
  return <div className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold text-white">Infrastructure fleet</h1><p className="mt-1 text-sm text-slate-600">A compact view of monitored network assets.</p></div><button onClick={()=>setShowAdd(true)} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"><Plus size={16}/> Add device</button></div><div className="grid gap-4 sm:grid-cols-3"><Stat label="Total" value={devices.length} icon={Server} hint="Registered assets"/><Stat label="Online" value={devices.filter(d=>d.status==="UP").length} icon={Wifi} tone="green" hint="Reachable now"/><Stat label="Offline" value={devices.filter(d=>d.status==="DOWN").length} icon={WifiOff} tone="red" hint="Needs attention"/></div><section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60"><div className="divide-y divide-slate-800/70">{devices.map(d=><div key={d.deviceId} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-4"><div className="rounded-xl border border-slate-800 bg-slate-950 p-3"><Server size={19} className="text-blue-400"/></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-white">{d.hostname}</p><Badge kind={statusKind(d.status)}>{d.status||"UNKNOWN"}</Badge></div><p className="mt-1 font-mono text-xs text-slate-500">{d.ipAddress}</p><p className="mt-1 text-xs text-slate-600">{d.vendor||"Unknown vendor"} · {d.deviceType||"device"} · {d.location||"No location"}</p></div></div><div className="flex items-center gap-5 text-xs"><div><p className="text-[10px] uppercase text-slate-700">Last poll</p><p className="mt-1 text-slate-400">{d.lastPollAt?new Date(d.lastPollAt).toLocaleTimeString():"Never"}</p></div><button onClick={()=>remove(d)} className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"><Trash2 size={15}/></button></div></div>)}{!devices.length&&<div className="p-12 text-center text-sm text-slate-600">No devices registered.</div>}</div></section>{showAdd&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={add} className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">Add network device</h3><p className="mt-1 text-xs text-slate-600">Register an SNMP-monitored asset.</p></div><button type="button" onClick={()=>setShowAdd(false)}><X size={19}/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><input required placeholder="Hostname" value={form.hostname} onChange={e=>setForm({...form,hostname:e.target.value})} className="form-input"/><input required placeholder="IP address" value={form.ipAddress} onChange={e=>setForm({...form,ipAddress:e.target.value})} className="form-input"/><select value={form.deviceType} onChange={e=>setForm({...form,deviceType:e.target.value})} className="form-input"><option value="router">Router</option><option value="switch">Switch</option><option value="firewall">Firewall</option><option value="server">Server</option><option value="other">Other</option></select><input placeholder="Vendor" value={form.vendor} onChange={e=>setForm({...form,vendor:e.target.value})} className="form-input"/><input placeholder="SNMP community" value={form.community} onChange={e=>setForm({...form,community:e.target.value})} className="form-input"/><select value={form.pollingInterval} onChange={e=>setForm({...form,pollingInterval:e.target.value})} className="form-input"><option value="10">10 sec polling</option><option value="30">30 sec polling</option><option value="60">60 sec polling</option></select></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setShowAdd(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?"Adding...":"Add device"}</button></div></form></div>}</div>;
}

export default function NocDashboard(){
  const [page,setPage]=useState("overview"); const [incidents,setIncidents]=useState([]); const [devices,setDevices]=useState([]); const [loading,setLoading]=useState(true);
  async function reload(){try{setLoading(true);const [i,d]=await Promise.all([getIncidents(),getDevices()]);if(i.success)setIncidents(i.incidents||[]);if(d.success)setDevices(d.devices||[])}catch(e){console.error(e)}finally{setLoading(false)}}
  useEffect(()=>{reload();const socket=io(SOCKET_URL,{transports:["websocket","polling"]});socket.on("incident_created",x=>setIncidents(c=>c.some(i=>i.incidentId===x.incidentId)?c:[x,...c]));socket.on("incident_updated",x=>setIncidents(c=>c.map(i=>i.incidentId===x.incidentId?x:i)));socket.on("device_updated",x=>setDevices(c=>c.some(d=>d.deviceId===x.deviceId)?c.map(d=>d.deviceId===x.deviceId?x:d):[x,...c]));return()=>socket.disconnect()},[]);
  const counts={active:incidents.filter(i=>i.status!=="RESOLVED").length};
  return <Shell page={page} setPage={setPage} counts={counts}><div className="mb-4 flex items-center justify-end"><button onClick={reload} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400 hover:text-white"><RefreshCw size={13} className={loading?"animate-spin":""}/> Refresh</button></div>{page==="overview"&&<Overview incidents={incidents} devices={devices} go={setPage}/>} {page==="incidents"&&<IncidentCenter incidents={incidents} reload={reload}/>} {page==="interfaces"&&<InterfaceHealthCenter/>} {page==="devices"&&<Devices devices={devices} reload={reload}/>}</Shell>;
}
