import { useEffect, useState } from "react";
import { MapPin, Server, AlertTriangle, WifiOff } from "lucide-react";
import { getPlatformSites } from "../services/platformApi";
import { PageHeader, LoadingRow } from "./ui";

export default function PlatformSites() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlatformSites().then(r => { if (r.success) setSites(r.sites); }).finally(() => setLoading(false));
  }, []);

  return <div className="space-y-5">
    <PageHeader icon={MapPin} title="Sites" subtitle="Every physical/network location across every realm." />
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.3fr_1fr_100px_100px_140px]"><span>Site</span><span>Realm</span><span>Devices</span><span>Down</span><span>Active incidents</span></div>
      {loading ? <LoadingRow /> : sites.length ? sites.map(s => <div key={s._id} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.3fr_1fr_100px_100px_140px]">
        <div><p className="text-sm font-semibold text-white">{s.name}</p><p className="truncate text-xs text-slate-600">{s.address || "No address set"}</p></div>
        <div className="truncate text-sm text-slate-400">{s.realmName || "—"}</div>
        <div className="flex items-center gap-1.5 text-sm text-slate-300"><Server size={13} className="text-slate-600" />{s.deviceCount}</div>
        <div className="flex items-center gap-1.5 text-sm text-slate-300">{s.devicesDown > 0 && <WifiOff size={13} className="text-red-400" />}<span className={s.devicesDown > 0 ? "text-red-400" : ""}>{s.devicesDown}</span></div>
        <div className="flex items-center gap-1.5 text-sm text-slate-300">{s.activeIncidentCount > 0 && <AlertTriangle size={13} className="text-amber-400" />}<span className={s.activeIncidentCount > 0 ? "text-amber-400" : ""}>{s.activeIncidentCount}</span></div>
      </div>) : <div className="p-12 text-center text-sm text-slate-600">No sites found.</div>}
    </section>
  </div>;
}
