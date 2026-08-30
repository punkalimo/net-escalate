import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getPlatformIncidents } from "../services/platformApi";
import { PageHeader, LoadingRow, Pill, severityTone } from "./ui";

const STATUS_TONE = { OPEN: "border-blue-500/30 bg-blue-500/10 text-blue-400", CALLING: "border-purple-500/30 bg-purple-500/10 text-purple-400", ESCALATING: "border-orange-500/30 bg-orange-500/10 text-orange-400", ACKNOWLEDGED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", RESOLVED: "border-slate-700 bg-slate-800/60 text-slate-500", FAILED: "border-red-500/30 bg-red-500/10 text-red-400" };

export default function PlatformIncidents() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("ACTIVE");

  useEffect(() => {
    setLoading(true);
    getPlatformIncidents({ status }).then(r => { if (r.success) setIncidents(r.incidents); }).finally(() => setLoading(false));
  }, [status]);

  return <div className="space-y-5">
    <PageHeader icon={AlertTriangle} title="Incidents" subtitle="Every incident across every realm." action={
      <select value={status} onChange={e => setStatus(e.target.value)} className="form-input sm:w-48"><option value="ACTIVE">Active only</option><option value="ALL">All incidents</option><option value="RESOLVED">Resolved</option></select>
    } />
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[130px_1fr_1fr_90px_120px]"><span>Incident</span><span>Realm</span><span>Device</span><span>Severity</span><span>Status</span></div>
      {loading ? <LoadingRow /> : incidents.length ? incidents.map(i => <div key={i.incidentId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[130px_1fr_1fr_90px_120px]">
        <p className="font-mono text-xs font-semibold text-white">{i.incidentId}</p>
        <div className="truncate text-sm text-slate-400">{i.realmName || "—"}</div>
        <div className="truncate text-sm text-slate-300">{i.device}</div>
        <div><Pill className={severityTone[i.severity] || severityTone.low}>{i.severity}</Pill></div>
        <div><Pill className={STATUS_TONE[i.status] || STATUS_TONE.OPEN}>{i.status}</Pill></div>
      </div>) : <div className="p-12 text-center text-sm text-slate-600">No incidents found.</div>}
    </section>
  </div>;
}
