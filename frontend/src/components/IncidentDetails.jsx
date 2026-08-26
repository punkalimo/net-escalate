import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Phone, Radio, RefreshCw, ShieldAlert, UserRound, X, Zap } from "lucide-react";
import { getIncident, resolveIncident } from "../services/api";

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
