import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { getPlatformTechnicians } from "../services/platformApi";
import { PageHeader, LoadingRow } from "./ui";

export default function PlatformTechnicians() {
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlatformTechnicians().then(r => { if (r.success) setTechnicians(r.technicians); }).finally(() => setLoading(false));
  }, []);

  return <div className="space-y-5">
    <PageHeader icon={UserRound} title="Technicians" subtitle="Every technician across every realm." />
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.4fr_1fr_1fr_80px_100px]"><span>Technician</span><span>Realm</span><span>Phone</span><span>Level</span><span>Status</span></div>
      {loading ? <LoadingRow /> : technicians.length ? technicians.map(t => <div key={t.technicianId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.4fr_1fr_1fr_80px_100px]">
        <div><p className="text-sm font-semibold text-white">{t.name}</p><p className="font-mono text-[10px] text-slate-600">{t.technicianId}</p></div>
        <div className="truncate text-sm text-slate-400">{t.realmName || "—"}</div>
        <div className="font-mono text-sm text-slate-300">{t.phone}</div>
        <div><span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-400">L{t.level}</span></div>
        <div className={`text-[10px] font-semibold uppercase ${t.active ? "text-emerald-400" : "text-slate-600"}`}>{t.active ? "Active" : "Disabled"}</div>
      </div>) : <div className="p-12 text-center text-sm text-slate-600">No technicians found.</div>}
    </section>
  </div>;
}
