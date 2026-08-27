import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BrainCircuit, ChevronDown, ChevronRight, RefreshCw, Route, ShieldAlert, Unlink, X } from "lucide-react";
import { getIncidentCorrelation, rebuildIncidentCorrelation, unmergeIncident } from "../services/api";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const severityTone = { critical: "text-red-400 bg-red-500/10 border-red-500/20", high: "text-orange-400 bg-orange-500/10 border-orange-500/20", medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", low: "text-blue-400 bg-blue-500/10 border-blue-500/20" };

function Confidence({ value }) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = n >= 80 ? "text-emerald-400" : n >= 60 ? "text-yellow-400" : "text-orange-400";
  return <div className="min-w-[92px]"><div className="flex justify-between text-[10px]"><span className="text-slate-600">Confidence</span><span className={`font-bold ${tone}`}>{n}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-current" style={{ width: `${n}%` }} /></div></div>;
}

function Group({ group, incidents, onClose, onChanged }) {
  const [expanded, setExpanded] = useState(true);
  const [unmerging, setUnmerging] = useState(null);
  const root = incidents.find(i => i.incidentId === group.rootIncidentId);

  async function unmerge(incidentId) {
    setUnmerging(incidentId);
    try { await unmergeIncident(incidentId); onChanged?.(); }
    catch (e) { /* transient - the child row simply stops showing a spinner and the group stays as-is until the next refresh */ }
    finally { setUnmerging(null); }
  }
  return <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-black/10">
    <button onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-4 p-5 text-left hover:bg-slate-800/20">
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-2.5 text-red-400"><ShieldAlert size={18}/></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-white">{group.correlationGroupId}</span><span className="rounded-full border border-red-500/20 bg-red-500/5 px-2 py-1 text-[9px] font-bold uppercase text-red-400">ROOT CAUSE</span>{root?.severity && <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${severityTone[root.severity] || severityTone.medium}`}>{root.severity}</span>}</div><p className="mt-1 text-sm font-semibold text-slate-200">{group.rootIncidentId} · {group.rootDevice}</p><p className="mt-1 text-xs text-slate-600">{group.children.length} correlated downstream incident{group.children.length === 1 ? "" : "s"} · blast radius {group.blastRadius + 1}</p></div>
      <div className="hidden sm:block"><Confidence value={100}/></div>{expanded ? <ChevronDown size={17} className="text-slate-600"/> : <ChevronRight size={17} className="text-slate-600"/>}
    </button>
    {expanded && <div className="border-t border-slate-800/80 p-5"><div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
      <div className="rounded-xl border border-red-500/10 bg-red-500/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Root incident</p><p className="mt-2 font-mono text-sm font-bold text-white">{root?.incidentId || group.rootIncidentId}</p>
        {group.rootCause ? <>
          <div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded-full border border-purple-500/20 bg-purple-500/5 px-2 py-0.5 text-[9px] font-bold uppercase text-purple-300">{group.rootCause.label}</span><span className="text-[10px] text-slate-600">{group.rootCause.confidence}% root cause confidence</span></div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{group.rootCause.description}</p>
          {group.rootCause.evidence?.length > 0 && <div className="mt-2 space-y-1">{group.rootCause.evidence.map((e, i) => <p key={i} className="text-[10px] leading-4 text-slate-600">• {e}</p>)}</div>}
        </> : <p className="mt-1 text-sm text-slate-300">{root?.description || "Root fault detected by correlation engine."}</p>}
        <div className="mt-4 space-y-2 text-xs"><div className="flex justify-between"><span className="text-slate-600">Device</span><span className="text-slate-300">{root?.device || group.rootDevice}</span></div>{group.rootCause?.interfaceName && <div className="flex justify-between"><span className="text-slate-600">Interface</span><span className="text-slate-300">{group.rootCause.interfaceName}</span></div>}<div className="flex justify-between"><span className="text-slate-600">Source</span><span className="text-slate-300">{root?.source || "MONITOR"}</span></div><div className="flex justify-between"><span className="text-slate-600">Started</span><span className="text-slate-300">{root?.createdAt ? new Date(root.createdAt).toLocaleString() : "—"}</span></div>{group.blastRadiusDetail && <><div className="flex justify-between"><span className="text-slate-600">Sites affected</span><span className="text-slate-300">{group.blastRadiusDetail.sitesAffected.length || "—"}</span></div><div className="flex justify-between"><span className="text-slate-600">Interfaces affected</span><span className="text-slate-300">{group.blastRadiusDetail.affectedInterfaceCount || "—"}</span></div><div className="flex justify-between"><span className="text-slate-600">Upstream device</span><span className="text-slate-300">{group.blastRadiusDetail.upstreamDevice?.hostname || "None known"}</span></div></>}</div>
        {group.blastRadiusDetail?.chain?.length > 1 && <div className="mt-4 flex flex-wrap items-center gap-1.5">{group.blastRadiusDetail.chain.map((step, i) => <div key={i} className="flex items-center gap-1.5">{i > 0 && <span className="text-slate-700">→</span>}<div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5"><p className="text-[8px] uppercase tracking-wider text-slate-600">{step.tier}</p><p className="text-[10px] font-semibold text-slate-300">{step.label || `${step.count}`}</p></div></div>)}</div>}
        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Close RCA panel</button></div>
      <div><p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-600">Downstream impact</p><div className="space-y-2">{group.children.map(child => { const incident = incidents.find(i => i.incidentId === child.incidentId); return <div key={child.incidentId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="flex items-center gap-3"><div className="h-px w-6 bg-slate-700"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-white">{child.incidentId}</span>{incident?.severity && <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase ${severityTone[incident.severity] || severityTone.medium}`}>{incident.severity}</span>}</div><p className="mt-1 text-xs text-slate-500">{child.device}</p></div><Confidence value={child.confidence}/></div><div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-600"><span className="rounded-full border border-slate-800 px-2 py-1">{child.hops != null ? `${child.hops} hop${child.hops === 1 ? "" : "s"}` : "manual link"}</span>{child.path?.length > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/10 bg-blue-500/5 px-2 py-1 text-blue-400"><Route size={10}/> Topology path {child.path.length} edge{child.path.length === 1 ? "" : "s"}</span>}<button onClick={() => unmerge(child.incidentId)} disabled={unmerging === child.incidentId} className="ml-auto rounded-full border border-slate-800 px-2 py-1 font-semibold text-slate-500 hover:border-red-500/30 hover:text-red-400 disabled:opacity-40" title="Remove from this correlation group"><Unlink size={10} className="mr-1 inline"/>{unmerging === child.incidentId ? "Unmerging…" : "Unmerge"}</button></div>{child.evidence?.length > 0 && <div className="mt-3 space-y-1">{child.evidence.map((e, i) => <p key={i} className="text-[10px] leading-4 text-slate-600">• {e}</p>)}</div>}</div>; })}</div></div>
    </div></div>}
  </div>;
}

export default function RootCauseCenter() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState("");

  async function load(refresh = false) {
    try { setLoading(true); setError(""); const result = await getIncidentCorrelation(refresh); if (!result.success) throw new Error(result.message || "Correlation failed."); setData(result); setIncidents(result.incidents || []); }
    catch (e) { setError(e.response?.data?.message || e.message || "Unable to load RCA data."); }
    finally { setLoading(false); }
  }

  async function rebuild() {
    try { setRebuilding(true); setError(""); const result = await rebuildIncidentCorrelation(); if (!result.success) throw new Error(result.message || "Rebuild failed."); setData(result); setIncidents(result.incidents || []); }
    catch (e) { setError(e.response?.data?.message || e.message || "Unable to rebuild correlation."); }
    finally { setRebuilding(false); }
  }

  useEffect(() => { if (open && !data) load(); }, [open, data]);
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("netescalate:open-rca", openHandler);
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    const update = result => { if (result?.success) { setData(result); setIncidents(result.incidents || []); } };
    socket.on("incident_correlation_updated", update);
    socket.on("incident_created", () => { if (open) load(); });
    socket.on("incident_updated", () => { if (open) load(); });
    return () => { window.removeEventListener("netescalate:open-rca", openHandler); socket.disconnect(); };
  }, [open]);

  const groups = useMemo(() => data?.groups || [], [data]);
  const correlated = data?.suppressedChildren || 0;

  return <>
    <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-[55] flex items-center gap-2 rounded-2xl border border-purple-500/30 bg-[#0b1020]/95 px-3 py-3 text-xs font-bold text-purple-300 shadow-2xl shadow-purple-950/30 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-purple-400/50 hover:bg-[#11182a] sm:bottom-5 sm:left-auto sm:right-[calc(50%+120px)]" title="Open Root Cause Analysis"><BrainCircuit size={17}/><span className="hidden sm:inline">RCA</span>{groups.length > 0 && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] text-red-400">{groups.length}</span>}</button>
    {open && <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <aside className="absolute inset-0 flex h-full w-full max-w-none flex-col border-0 bg-[#060b14] shadow-2xl">
        <div className="flex items-center gap-4 border-b border-slate-800 px-5 py-4"><div className="rounded-xl border border-purple-500/20 bg-purple-500/10 p-2.5 text-purple-400"><BrainCircuit size={19}/></div><div className="min-w-0 flex-1"><h2 className="font-semibold text-white">Root Cause Analysis</h2><p className="text-[10px] text-slate-600">Topology-aware incident correlation and blast-radius analysis</p></div><button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18}/></button></div>
        <div className="border-b border-slate-800/80 p-4"><div className="grid gap-2 sm:grid-cols-4"><div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"><p className="text-[9px] uppercase tracking-widest text-slate-600">Active</p><p className="mt-1 text-xl font-bold text-white">{data?.activeIncidents ?? "—"}</p></div><div className="rounded-xl border border-purple-500/10 bg-purple-500/[0.03] p-3"><p className="text-[9px] uppercase tracking-widest text-slate-600">RCA groups</p><p className="mt-1 text-xl font-bold text-purple-300">{groups.length}</p></div><div className="rounded-xl border border-orange-500/10 bg-orange-500/[0.03] p-3"><p className="text-[9px] uppercase tracking-widest text-slate-600">Suppressed symptoms</p><p className="mt-1 text-xl font-bold text-orange-300">{correlated}</p></div><div className="flex items-center justify-end gap-2 sm:col-span-1"><button disabled={loading || rebuilding} onClick={() => load(true)} className="rounded-xl border border-slate-700 p-3 text-slate-400 hover:text-white disabled:opacity-40" title="Refresh correlation"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/></button><button disabled={rebuilding} onClick={rebuild} className="flex items-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40"><Activity size={14}/>{rebuilding ? "Rebuilding…" : "Rebuild RCA"}</button></div></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-500/10 bg-blue-500/[0.03] p-4"><AlertTriangle size={16} className="mt-0.5 text-blue-400"/><p className="text-xs leading-5 text-slate-500">RCA groups are hypotheses, not proof. Confidence is based on device state, severity, incident timing and topology distance. Review the evidence before taking corrective action.</p></div>{error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-400">{error}</div>}{loading && !data ? <div className="flex h-40 items-center justify-center text-sm text-slate-600"><RefreshCw size={16} className="mr-2 animate-spin"/>Analyzing active incidents…</div> : groups.length ? <div className="space-y-3">{groups.map(group => <Group key={group.correlationGroupId} group={group} incidents={incidents} onClose={() => setOpen(false)} onChanged={() => load(true)}/>)}</div> : <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center"><BrainCircuit size={32} className="mx-auto text-slate-700"/><p className="mt-3 text-sm font-semibold text-white">No correlated incident groups</p><p className="mt-1 text-xs text-slate-600">The engine currently sees no active multi-device condition strong enough to group.</p></div>}<p className="mt-5 text-center text-[9px] text-slate-700">Last analysis: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"}</p></div>
      </aside>
    </div>}
  </>;
}
