import { useEffect, useState } from "react";
import { Building2, UserRound, Server, AlertTriangle, Radio, RefreshCw } from "lucide-react";
import { getPlatformOverview } from "../services/platformApi";
import { StatCard, LoadingRow } from "./ui";

export default function CommandCenter() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { const r = await getPlatformOverview(); if (r.success) setOverview(r); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2"><span className="rounded-full border border-purple-500/20 bg-purple-500/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-400">Network Command Center</span></div>
        <h1 className="mt-3 text-3xl font-bold text-white">NetEscalate Platform</h1>
        <p className="mt-1 text-sm text-slate-500">A holistic view of every Realm running on this installation.</p>
      </div>
      <button onClick={load} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-400 hover:text-white"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
    </div>

    {loading && !overview ? <LoadingRow label="Loading platform overview…" /> : overview ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard label="Realms" value={overview.realms} icon={Building2} tone="purple" hint="Customer organizations" />
      <StatCard label="Users" value={overview.users} icon={UserRound} tone="blue" hint="With dashboard login access" />
      <StatCard label="Technicians" value={overview.technicians} icon={UserRound} tone="blue" hint="Escalation contacts, all realms" />
      <StatCard label="Devices" value={overview.devices} icon={Server} tone="green" hint="Monitored assets, all realms" />
      <StatCard label="Active incidents" value={overview.activeIncidents} icon={AlertTriangle} tone="amber" hint="Across every realm" />
      <StatCard label="Escalations today" value={overview.escalationsToday} icon={Radio} tone="red" hint="Technician calls initiated today" />
    </div> : null}
  </div>;
}
