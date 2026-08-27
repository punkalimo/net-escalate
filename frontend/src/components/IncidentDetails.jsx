import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Activity, AlertTriangle, CheckCircle2, Clock3, GitMerge, Network, Phone, Radio, RefreshCw, Server, ShieldAlert, Unlink, UserRound, X, Zap } from "lucide-react";
import { getIncident, getIncidentBlastRadius, getIncidentRootCause, getIncidents, mergeIncident, resolveIncident, unmergeIncident } from "../services/api";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const statusStyles = {
  OPEN: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  CALLING: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  ESCALATING: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  ACKNOWLEDGED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  RESOLVED: "border-slate-700 bg-slate-800/70 text-slate-400",
  FAILED: "border-red-500/30 bg-red-500/10 text-red-400"
};

const historyStyles = {
  CALLING: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  ACKNOWLEDGED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  ESCALATED: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  FAILED: "border-red-500/30 bg-red-500/10 text-red-400",
  NO_ANSWER: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  DECLINED: "border-red-500/30 bg-red-500/10 text-red-400",
  PROVIDER_UNAVAILABLE: "border-red-500/30 bg-red-500/10 text-red-400"
};

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function elapsed(start, end) {
  if (!start) return "—";
  const ms = Math.max(0, new Date(end || Date.now()).getTime() - new Date(start).getTime());
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function Pill({ children, className = "" }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${className}`}>{children}</span>;
}

export default function IncidentDetails({ incident: initialIncident, onClose, onResolved }) {
  const [incident, setIncident] = useState(initialIncident);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!initialIncident?.incidentId) return;
    setLoading(true);
    try {
      const result = await getIncident(initialIncident.incidentId);
      if (!result.success) throw new Error(result.message || "Failed to load incident.");
      setIncident(result.incident);
      setError("");
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Unable to load incident details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    const handleUpdate = update => {
      if (update?.incidentId === initialIncident?.incidentId) {
        setIncident(update);
        setLoading(false);
        setError("");
      }
    };
    socket.on("incident_updated", handleUpdate);
    socket.on("incident_created", handleUpdate);
    return () => socket.disconnect();
  }, [initialIncident?.incidentId]);

  const history = useMemo(() => [...(incident?.escalationHistory || [])].sort((a, b) => new Date(a.startedAt || 0) - new Date(b.startedAt || 0)), [incident]);
  const currentStage = incident?.escalationLevel || 1;
  const live = ["CALLING", "ESCALATING"].includes(incident?.status);

  const [correlationBusy, setCorrelationBusy] = useState(false);
  const [correlationError, setCorrelationError] = useState("");
  const [mergePickerOpen, setMergePickerOpen] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState([]);
  const [mergeTargetId, setMergeTargetId] = useState("");

  const [rootCause, setRootCause] = useState(null);
  const [rootCauseLoading, setRootCauseLoading] = useState(true);

  const loadRootCause = async () => {
    if (!incident?.incidentId) return;
    setRootCauseLoading(true);
    try {
      const result = await getIncidentRootCause(incident.incidentId);
      if (result.success) setRootCause(result.rootCause);
    } catch (e) {
      // Non-fatal - the rest of the incident page still works without it.
    } finally {
      setRootCauseLoading(false);
    }
  };

  useEffect(() => { loadRootCause(); }, [incident?.incidentId, incident?.correlationRole, incident?.correlationGroupId]);

  const [blastRadius, setBlastRadius] = useState(null);
  const [blastRadiusLoading, setBlastRadiusLoading] = useState(true);

  const loadBlastRadius = async () => {
    if (!incident?.incidentId) return;
    setBlastRadiusLoading(true);
    try {
      const result = await getIncidentBlastRadius(incident.incidentId);
      if (result.success) setBlastRadius(result.blastRadius);
    } catch (e) {
      // Non-fatal - the rest of the incident page still works without it.
    } finally {
      setBlastRadiusLoading(false);
    }
  };

  useEffect(() => { loadBlastRadius(); }, [incident?.incidentId, incident?.correlationRole, incident?.correlationGroupId, incident?.impactedDevices?.length]);

  async function openMergePicker() {
    setMergePickerOpen(true);
    setCorrelationError("");
    try {
      const result = await getIncidents();
      if (!result.success) throw new Error(result.message || "Failed to load incidents.");
      const candidates = (result.incidents || []).filter(i => i.incidentId !== incident.incidentId && i.status !== "RESOLVED" && !(i.correlationRole === "CHILD" && i.parentIncidentId));
      setMergeCandidates(candidates);
      setMergeTargetId(candidates[0]?.incidentId || "");
    } catch (e) {
      setCorrelationError(e.response?.data?.message || e.message || "Unable to load incidents to merge into.");
    }
  }

  async function merge() {
    if (!mergeTargetId) return;
    setCorrelationBusy(true);
    setCorrelationError("");
    try {
      const result = await mergeIncident(incident.incidentId, mergeTargetId);
      if (!result.success) throw new Error(result.message || "Failed to merge incident.");
      setIncident(result.source);
      setMergePickerOpen(false);
    } catch (e) {
      setCorrelationError(e.response?.data?.message || e.message || "Unable to merge incident.");
    } finally {
      setCorrelationBusy(false);
    }
  }

  async function unmerge() {
    setCorrelationBusy(true);
    setCorrelationError("");
    try {
      const result = await unmergeIncident(incident.incidentId);
      if (!result.success) throw new Error(result.message || "Failed to unmerge incident.");
      setIncident(result.incident);
    } catch (e) {
      setCorrelationError(e.response?.data?.message || e.message || "Unable to unmerge incident.");
    } finally {
      setCorrelationBusy(false);
    }
  }

  async function resolve() {
    if (!incident?.incidentId || incident.status === "RESOLVED") return;
    setBusy(true);
    try {
      const result = await resolveIncident(incident.incidentId);
      if (!result.success) throw new Error(result.message || "Failed to resolve incident.");
      setIncident(result.incident);
      onResolved?.(result.incident);
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Unable to resolve incident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-[#050810]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-full flex-col bg-[#050810]">
        <header className="shrink-0 border-b border-slate-800/80 bg-[#080d16]/95 px-5 py-4 shadow-xl sm:px-8">
          <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={onClose} className="mr-1 rounded-lg border border-slate-800 p-2 text-slate-500 hover:bg-slate-800 hover:text-white" title="Back to incidents"><X size={17} /></button>
                <span className="font-mono text-sm font-bold text-white">{incident?.incidentId || initialIncident?.incidentId}</span>
                <Pill className={statusStyles[incident?.status] || statusStyles.OPEN}>{incident?.status || "LOADING"}</Pill>
                {live && <Pill className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />Live escalation</Pill>}
              </div>
              <p className="mt-1 pl-11 text-xs text-slate-500">Incident command · real-time escalation and response monitoring</p>
            </div>
            <div className="hidden items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600 sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live telemetry</div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1800px] p-5 sm:p-7 lg:p-8">
            {loading && !incident ? <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500"><RefreshCw size={16} className="mr-2 animate-spin" /> Loading incident…</div> : <div className="space-y-6">
              {error && <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{error}</div>}

              <section className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><ShieldAlert size={18} className="text-blue-400" /><span className="text-xs font-semibold uppercase tracking-[.16em] text-slate-500">Incident overview</span></div>
                    <div className="mt-3 flex flex-wrap items-center gap-3"><h2 className="text-2xl font-bold text-white sm:text-3xl">{incident?.device || "Unknown device"}</h2><Pill className={incident?.severity === "critical" ? "border-red-500/30 bg-red-500/10 text-red-400" : incident?.severity === "high" ? "border-orange-500/30 bg-orange-500/10 text-orange-400" : "border-slate-700 bg-slate-800 text-slate-400"}>{incident?.severity || "unknown"} severity</Pill></div>
                    <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-500">{incident?.description || "No description provided."}</p>
                  </div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-3 lg:min-w-[520px]">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Location</p><p className="mt-1 truncate text-sm text-slate-300">{incident?.location || "—"}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Created</p><p className="mt-1 text-sm text-slate-300">{formatTime(incident?.createdAt)}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Source</p><p className="mt-1 text-sm text-slate-300">{incident?.source || "MANUAL"}</p></div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.04] p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2"><ShieldAlert size={18} className="text-purple-400" /><span className="text-xs font-semibold uppercase tracking-[.16em] text-slate-500">{rootCause?.label || "Root cause"}</span>{rootCause && <Pill className={rootCause.confidence >= 75 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}>{rootCause.confidence}% root cause confidence</Pill>}</div>
                {rootCauseLoading && !rootCause ? <p className="mt-3 text-sm text-slate-500">Analyzing probable root cause…</p> : rootCause ? <>
                  <p className="mt-3 max-w-4xl text-sm leading-relaxed text-slate-300">{rootCause.description}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Root device</p><p className="mt-1 truncate text-sm text-slate-300">{rootCause.device || "—"}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Root interface</p><p className="mt-1 text-sm text-slate-300">{rootCause.interfaceName || "—"}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Affected devices</p><p className="mt-1 text-sm text-slate-300">{rootCause.affectedDeviceCount}</p></div>
                  </div>
                  {rootCause.evidence?.length > 0 && <div className="mt-4 space-y-1">{rootCause.evidence.map((e, i) => <p key={i} className="text-xs leading-5 text-slate-500">• {e}</p>)}</div>}
                </> : <p className="mt-3 text-sm text-slate-500">No root-cause analysis available yet.</p>}
              </section>

              <section className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5 sm:p-6">
                <div className="flex items-center gap-2"><Network size={18} className="text-amber-400" /><span className="text-xs font-semibold uppercase tracking-[.16em] text-slate-500">Blast radius</span></div>
                {blastRadiusLoading && !blastRadius ? <p className="mt-3 text-sm text-slate-500">Calculating blast radius…</p> : blastRadius ? <>
                  {blastRadius.chain?.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-2">{blastRadius.chain.map((step, i) => <div key={i} className="flex items-center gap-2">{i > 0 && <span className="text-slate-700">→</span>}<div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"><p className="text-[9px] uppercase tracking-wider text-slate-600">{step.tier}</p><p className="mt-0.5 text-xs font-semibold text-slate-200">{step.label || `${step.count} device${step.count === 1 ? "" : "s"}`}</p></div></div>)}</div>}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Affected devices</p><p className="mt-1 text-lg font-bold text-white">{blastRadius.affectedDeviceCount}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Affected interfaces</p><p className="mt-1 text-lg font-bold text-white">{blastRadius.affectedInterfaceCount}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Sites affected</p><p className="mt-1 text-lg font-bold text-white">{blastRadius.sitesAffected.length || "—"}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Upstream device</p><p className="mt-1 truncate text-sm text-slate-300">{blastRadius.upstreamDevice?.hostname || "None known"}</p></div>
                  </div>
                  {blastRadius.servicesPotentiallyAffected?.length > 0 && <p className="mt-3 text-xs text-slate-500">Potentially affected downstream: {blastRadius.servicesPotentiallyAffected.join(", ")}</p>}
                </> : <p className="mt-3 text-sm text-slate-500">No downstream impact detected.</p>}
              </section>

              <section className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5"><div className="flex items-center gap-2 text-blue-400"><Radio size={16} /><span className="text-[10px] font-bold uppercase tracking-wider">Escalation level</span></div><p className="mt-2 text-3xl font-bold text-white">L{currentStage}<span className="text-sm font-normal text-slate-600"> / 3</span></p></div>
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5"><div className="flex items-center gap-2 text-purple-400"><Phone size={16} /><span className="text-[10px] font-bold uppercase tracking-wider">Current technician</span></div><p className="mt-2 truncate text-sm font-semibold text-white">{incident?.technician?.name || "Unassigned"}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{incident?.technician?.phone || "—"}</p></div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5"><div className="flex items-center gap-2 text-emerald-400"><Activity size={16} /><span className="text-[10px] font-bold uppercase tracking-wider">Workflow state</span></div><p className="mt-2 text-sm font-semibold text-white">{live ? "Escalation in progress" : incident?.status === "ACKNOWLEDGED" ? "Technician acknowledged" : incident?.status === "RESOLVED" ? "Incident resolved" : incident?.status || "Unknown"}</p></div>
              </section>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.7fr)]">
                <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="flex items-center justify-between border-b border-slate-800 p-5"><div><div className="flex items-center gap-2"><Zap size={16} className="text-blue-400" /><h3 className="font-semibold text-white">Real-time escalation activity</h3></div><p className="mt-1 text-xs text-slate-600">Every technician attempt is recorded as the workflow progresses.</p></div><div className="flex items-center gap-2 text-[10px] text-slate-600">{live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}Socket live</div></div>
                  {!history.length ? <div className="p-10 text-center"><Clock3 className="mx-auto text-slate-700" /><p className="mt-3 text-sm text-slate-500">Waiting for the first escalation event…</p></div> : <div className="p-5"><div className="relative ml-2 border-l border-slate-800 pl-6">{history.map((entry, index) => <div key={`${entry.level}-${entry.startedAt}-${index}`} className="relative pb-7 last:pb-1"><div className="absolute -left-[31px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-[#080d16] bg-blue-500" /><div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300">LEVEL {entry.level}</span><Pill className={historyStyles[entry.status] || "border-slate-700 bg-slate-800 text-slate-400"}>{entry.status || "UNKNOWN"}</Pill></div><div className="mt-3 flex items-center gap-2"><UserRound size={14} className="text-slate-600" /><span className="text-sm font-semibold text-white">{entry.technicianName || "Unknown technician"}</span><span className="font-mono text-[10px] text-slate-600">{entry.technicianPhone || ""}</span></div></div><div className="text-left sm:text-right"><p className="text-[10px] text-slate-600">Started</p><p className="text-xs text-slate-400">{formatTime(entry.startedAt)}</p><p className="mt-1 text-[10px] text-slate-600">Duration {elapsed(entry.startedAt, entry.completedAt)}</p></div></div>{entry.response && <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-400">{entry.response}</p>}{(entry.provider || entry.providerCode || entry.callId) && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-600"><span>Provider: {entry.provider || "—"}</span><span>Call: {entry.callId || "—"}</span><span>Code: {entry.providerCode || "—"}</span></div>}</div></div>)}</div></div>}
                </section>

                <aside className="space-y-6">
                  {(blastRadius?.downstreamDevices?.length > 0 || incident?.impactedDevices?.length > 0) && <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                    {(() => { const list = blastRadius?.downstreamDevices?.length ? blastRadius.downstreamDevices : incident.impactedDevices.map(d => ({ deviceId: d.deviceId, hostname: d.hostname, status: d.status, interfaceName: null })); return <>
                      <div className="flex items-center gap-2"><Server size={16} className="text-amber-400" /><h3 className="font-semibold text-white">Downstream devices ({list.length})</h3></div>
                      <p className="mt-1 text-xs text-slate-500">Part of this incident's blast radius - explained by {incident.device}, not paged separately.</p>
                      <div className="mt-4 space-y-2">{list.map(d => <div key={d.deviceId || d.hostname} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                        <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-300">{d.hostname}</p>{d.interfaceName && <p className="text-[10px] text-slate-600">{d.interfaceName}</p>}</div>
                        <Pill className={d.status === "DOWN" ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-slate-700 bg-slate-800 text-slate-400"}>{d.status || "UNKNOWN"}</Pill>
                      </div>)}</div>
                    </>; })()}
                  </section>}
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                    <div className="flex items-center gap-2"><Network size={16} className="text-purple-400" /><h3 className="font-semibold text-white">Correlation</h3></div>
                    {correlationError && <p className="mt-3 text-xs text-red-400">{correlationError}</p>}
                    {incident?.correlationRole === "ROOT" && <div className="mt-3"><Pill className="border-red-500/20 bg-red-500/5 text-red-400">Root cause</Pill><p className="mt-2 text-xs leading-5 text-slate-500">Other active incidents are correlated to this one as a probable downstream symptom. See the RCA panel for the full group ({incident.correlationGroupId}).</p></div>}
                    {incident?.correlationRole === "CHILD" && <div className="mt-3">
                      <Pill className="border-purple-500/20 bg-purple-500/5 text-purple-400">Correlated</Pill>
                      <p className="mt-2 text-xs leading-5 text-slate-500">Linked as a probable downstream symptom of <span className="font-mono text-slate-300">{incident.parentIncidentId}</span>{incident.correlationConfidence != null && ` · ${incident.correlationConfidence}% confidence`}.</p>
                      {incident.correlationEvidence?.length > 0 && <div className="mt-2 space-y-1">{incident.correlationEvidence.map((e, i) => <p key={i} className="text-[10px] leading-4 text-slate-600">• {e}</p>)}</div>}
                      <button onClick={unmerge} disabled={correlationBusy} className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"><Unlink size={13} />{correlationBusy ? "Unmerging…" : "Unmerge from root"}</button>
                    </div>}
                    {(!incident?.correlationRole || incident.correlationRole === "STANDALONE") && <div className="mt-3">
                      <p className="text-xs leading-5 text-slate-500">No correlation detected for this incident yet.</p>
                      {!mergePickerOpen ? <button onClick={openMergePicker} className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"><GitMerge size={13} />Merge into…</button> : <div className="mt-3 space-y-2">
                        <select value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-300">
                          {mergeCandidates.length === 0 && <option value="">No other active incidents</option>}
                          {mergeCandidates.map(c => <option key={c.incidentId} value={c.incidentId}>{c.incidentId} · {c.device}</option>)}
                        </select>
                        <div className="flex gap-2"><button onClick={merge} disabled={correlationBusy || !mergeTargetId} className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{correlationBusy ? "Merging…" : "Confirm merge"}</button><button onClick={() => setMergePickerOpen(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400">Cancel</button></div>
                      </div>}
                    </div>}
                  </section>
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><div className="flex items-center gap-2"><Radio size={16} className="text-blue-400" /><h3 className="font-semibold text-white">Escalation command</h3></div><div className="mt-5 space-y-3">{[1,2,3].map(level=>{const activeLevel=currentStage===level;const completed=currentStage>level||incident?.status==="ACKNOWLEDGED"||incident?.status==="RESOLVED";return <div key={level} className={`flex items-center gap-3 rounded-xl border p-3 ${activeLevel?"border-blue-500/30 bg-blue-500/10":"border-slate-800 bg-slate-950/40"}`}><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${completed?"bg-emerald-500/15 text-emerald-400":activeLevel?"bg-blue-500/15 text-blue-400":"bg-slate-800 text-slate-600"}`}>{completed?"✓":`L${level}`}</div><div className="min-w-0"><p className="text-xs font-semibold text-slate-300">Level {level}</p><p className="text-[10px] text-slate-600">{activeLevel?"Current escalation stage":completed?"Completed":"Standby"}</p></div>{activeLevel&&<span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-blue-400"/>}</div>})}</div></section>
                  {incident?.acknowledgement && <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5"><div className="flex gap-3"><CheckCircle2 className="shrink-0 text-emerald-400" size={18} /><div><p className="text-xs font-semibold text-emerald-300">Technician acknowledgement</p><p className="mt-1 text-sm leading-relaxed text-slate-400">{incident.acknowledgement}</p></div></div></section>}
                </aside>
              </div>
            </div>}
          </div>
        </div>

        <footer className="shrink-0 border-t border-slate-800 bg-[#080d16] px-5 py-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3"><button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-white"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button><div className="flex items-center gap-2">{incident?.status !== "RESOLVED" && <button onClick={resolve} disabled={busy || loading} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Resolving…" : "Resolve incident"}</button>}<button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300">Back to incidents</button></div></div>
        </footer>
      </div>
    </div>
  );
}
