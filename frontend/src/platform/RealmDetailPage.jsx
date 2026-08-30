import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Building2, Server, UserRound, AlertTriangle, LogIn, ArrowLeft, Gauge } from "lucide-react";
import { getRealm, enterRealm } from "../services/platformApi";
import { StatCard, LoadingRow, Pill, statusTone } from "./ui";

export default function RealmDetailPage() {
  const { realmId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    setLoading(true);
    getRealm(realmId).then(r => { if (r.success) setData(r); }).finally(() => setLoading(false));
  }, [realmId]);

  async function doEnter() {
    setEntering(true);
    try {
      const r = await enterRealm(realmId);
      if (r.success) window.location.href = "/";
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setEntering(false); }
  }

  if (loading) return <LoadingRow label="Loading realm…" />;
  if (!data) return <div className="p-12 text-center text-sm text-slate-600">Realm not found.</div>;

  const { realm, overview } = data;

  return <div className="space-y-6">
    <button onClick={() => navigate("/platform/realms")} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white"><ArrowLeft size={13} />Back to realms</button>

    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-2 text-purple-400"><Building2 size={17} /></div><h1 className="text-2xl font-bold text-white">{realm.name}</h1><Pill className={statusTone[realm.status] || statusTone.disabled}>{realm.status}</Pill></div>
        <p className="mt-2 text-sm text-slate-500">{realm.slug} · {realm.industry} · {realm.subscriptionPlan}</p>
      </div>
      <button onClick={doEnter} disabled={entering} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><LogIn size={16} />{entering ? "Entering…" : "Enter realm"}</button>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Devices" value={realm.deviceCount} icon={Server} tone="green" />
      <StatCard label="Technicians" value={realm.technicianCount} icon={UserRound} tone="blue" />
      <StatCard label="Active incidents" value={realm.activeIncidentCount} icon={AlertTriangle} tone="amber" />
      <StatCard label="MTTA / MTTR" value={`${overview?.meanTimeToAcknowledgeMinutes ?? "—"}m / ${overview?.meanTimeToResolveMinutes ?? "—"}m`} icon={Gauge} tone="purple" />
    </div>

    {overview && <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="font-semibold text-white">Incident overview</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Critical</p><p className="mt-1 text-lg font-bold text-white">{overview.criticalIncidents}</p></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">SLA breaches</p><p className="mt-1 text-lg font-bold text-white">{overview.slaBreaches}</p></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Devices affected</p><p className="mt-1 text-lg font-bold text-white">{overview.devicesAffected}</p></div>
      </div>
    </section>}
  </div>;
}
