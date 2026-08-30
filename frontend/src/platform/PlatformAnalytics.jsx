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
    </div> : null}
  </div>;
}
