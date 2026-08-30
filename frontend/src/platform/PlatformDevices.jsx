import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { getPlatformDevices } from "../services/platformApi";
import { PageHeader, LoadingRow, Pill } from "./ui";

const STATUS_TONE = { UP: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", DOWN: "border-red-500/30 bg-red-500/10 text-red-400", DEGRADED: "border-orange-500/30 bg-orange-500/10 text-orange-400", UNKNOWN: "border-slate-700 bg-slate-800/60 text-slate-500" };

export default function PlatformDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlatformDevices().then(r => { if (r.success) setDevices(r.devices); }).finally(() => setLoading(false));
  }, []);

  return <div className="space-y-5">
    <PageHeader icon={Server} title="Devices" subtitle="Global device inventory across every realm." />
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.3fr_1fr_1fr_1fr_100px]"><span>Device</span><span>Realm</span><span>IP address</span><span>Vendor / model</span><span>Status</span></div>
      {loading ? <LoadingRow /> : devices.length ? devices.map(d => <div key={d.deviceId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.3fr_1fr_1fr_1fr_100px]">
        <div><p className="text-sm font-semibold text-white">{d.hostname}</p><p className="font-mono text-[10px] text-slate-600">{d.deviceId}</p></div>
        <div className="truncate text-sm text-slate-400">{d.realmName || "—"}</div>
        <div className="font-mono text-sm text-slate-300">{d.ipAddress}</div>
        <div className="truncate text-sm text-slate-400">{d.vendor || "—"} {d.model}</div>
        <div><Pill className={STATUS_TONE[d.status] || STATUS_TONE.UNKNOWN}>{d.status}</Pill></div>
      </div>) : <div className="p-12 text-center text-sm text-slate-600">No devices found.</div>}
    </section>
  </div>;
}
