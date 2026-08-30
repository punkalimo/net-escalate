import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { getPlatformAnalytics } from "../services/platformApi";
import { PageHeader, LoadingRow } from "./ui";

export default function PlatformAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPlatformAnalytics(days).then(r => { if (r.success) setData(r); }).finally(() => setLoading(false));
  }, [days]);

  const maxIncidents = data ? Math.max(1, ...data.incidentsByRealm.map(r => r.count)) : 1;

  return <div className="space-y-5">
    <PageHeader icon={BarChart3} title="Analytics" subtitle="Cross-realm incident and escalation comparison." action={
      <select value={days} onChange={e => setDays(Number(e.target.value))} className="form-input sm:w-40"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
    } />

    {loading ? <LoadingRow /> : data ? <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="font-semibold text-white">Incidents by realm - last {data.windowDays} days</h3>
        <div className="mt-4 space-y-3">
          {data.incidentsByRealm.length ? data.incidentsByRealm.map(row => <div key={row.realmId} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-xs text-slate-400">{row.realmName}</span>
            <div className="h-6 flex-1 overflow-hidden rounded-full bg-slate-950/60"><div className="h-full rounded-full bg-purple-500/60" style={{ width: `${(row.count / maxIncidents) * 100}%` }} /></div>
            <span className="w-10 shrink-0 text-right text-xs font-semibold text-white">{row.count}</span>
          </div>) : <p className="text-sm text-slate-600">No incidents in this window.</p>}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold text-white">Severity breakdown</h3>
          <div className="mt-4 space-y-2">{Object.entries(data.severityBreakdown).map(([severity, count]) => <div key={severity} className="flex items-center justify-between text-sm"><span className="capitalize text-slate-400">{severity}</span><span className="font-semibold text-white">{count}</span></div>)}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="font-semibold text-white">Escalation engine usage</h3>
          <div className="mt-4 space-y-2 text-xs">{data.escalationsByRealm.length ? data.escalationsByRealm.map(row => <div key={row.realmId} className="flex items-center justify-between border-b border-slate-800/60 pb-2 last:border-0"><span className="text-slate-400">{row.realmName}</span><span className="text-slate-300">{row.triggered} triggered · {row.resolved} resolved · {row.failed} failed</span></div>) : <p className="text-slate-600">No escalation activity in this window.</p>}</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
        <div className="border-b border-slate-800/80 bg-slate-950/50 px-5 py-3"><h3 className="text-sm font-semibold text-white">Site performance - last {data.windowDays} days</h3></div>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/30 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.2fr_1fr_90px_90px_90px_90px]"><span>Site</span><span>Realm</span><span>Devices</span><span>Down</span><span>Incidents</span><span>Escalated</span></div>
        {data.sites.length ? data.sites.map(s => <div key={s.siteId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-3 text-sm last:border-0 md:grid-cols-[1.2fr_1fr_90px_90px_90px_90px]">
          <span className="truncate font-medium text-white">{s.name}</span>
          <span className="truncate text-slate-400">{s.realmName}</span>
          <span className="text-slate-300">{s.deviceCount}</span>
          <span className={s.devicesDown ? "text-red-400" : "text-slate-300"}>{s.devicesDown}</span>
          <span className="text-slate-300">{s.incidents}</span>
          <span className={s.escalated ? "text-amber-400" : "text-slate-300"}>{s.escalated}</span>
        </div>) : <div className="p-8 text-center text-sm text-slate-600">No sites configured yet.</div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
        <div className="border-b border-slate-800/80 bg-slate-950/50 px-5 py-3"><h3 className="text-sm font-semibold text-white">Technician performance - all time</h3></div>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/30 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.1fr_1fr_1fr_80px_80px_90px_90px_100px]"><span>Technician</span><span>Realm</span><span>Role</span><span>Active</span><span>Resolved</span><span>Ack rate</span><span>Mean TTA</span><span>Escalated away</span></div>
        {data.technicians.length ? data.technicians.map(t => <div key={t.technicianId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-3 text-sm last:border-0 md:grid-cols-[1.1fr_1fr_1fr_80px_80px_90px_90px_100px]">
          <span className="truncate font-medium text-white">{t.name}</span>
          <span className="truncate text-slate-400">{t.realmName}</span>
          <span className="truncate text-slate-400">{(t.realmRole || "technician").replaceAll("_", " ")}</span>
          <span className={t.activeIncidents ? "text-amber-400" : "text-slate-300"}>{t.activeIncidents}</span>
          <span className="text-slate-300">{t.resolvedIncidents}</span>
          <span className="text-slate-300">{t.acknowledgeRate != null ? `${t.acknowledgeRate}%` : "—"}</span>
          <span className="text-slate-300">{t.meanTimeToAcknowledgeMinutes != null ? `${t.meanTimeToAcknowledgeMinutes}m` : "—"}</span>
          <span className={t.escalatedAway ? "text-red-400" : "text-slate-300"}>{t.escalatedAway}</span>
        </div>) : <div className="p-8 text-center text-sm text-slate-600">No technicians found.</div>}
      </section>
    </div> : null}
  </div>;
}
