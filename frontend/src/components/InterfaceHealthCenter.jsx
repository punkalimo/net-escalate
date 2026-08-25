import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, Server, Wifi, WifiOff } from "lucide-react";
import { io } from "socket.io-client";
import { getDevices, getInterfaceHistory } from "../services/api";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const healthStyles = {
  HEALTHY: "text-green-400 border-green-500/30 bg-green-500/5",
  WARNING: "text-yellow-400 border-yellow-500/30 bg-yellow-500/5",
  DEGRADED: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  CRITICAL: "text-red-400 border-red-500/30 bg-red-500/5",
  DOWN: "text-red-400 border-red-500/30 bg-red-500/5",
  UNKNOWN: "text-slate-400 border-slate-700 bg-slate-900"
};

function rate(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} Mbps`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} Kbps`;
  return `${Math.round(n)} bps`;
}

function speed(value) {
  if (value == null) return "N/A";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} Gbps` : `${value} Mbps`;
}

function MiniChart({ samples }) {
  if (!samples.length) return <div className="flex h-32 items-center justify-center text-xs text-slate-600">No historical samples yet.</div>;
  const values = samples.map(s => Math.max(0, Math.min(100, Number(s.utilizationPercent || 0))));
  const max = Math.max(100, ...values);
  return <div className="h-32 rounded-lg border border-slate-800 bg-slate-950/70 p-2">
    <div className="flex h-full items-end gap-1">
      {values.slice(-60).map((value, index) => <div key={`${index}-${value}`} title={`${value.toFixed(1)}%`} className="min-w-[3px] flex-1 rounded-t bg-blue-500/70" style={{ height: `${Math.max(2, value / max * 100)}%` }} />)}
    </div>
  </div>;
}

export default function InterfaceHealthCenter() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [ifIndex, setIfIndex] = useState("");
  const [hours, setHours] = useState(24);
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedDevice = devices.find(d => d.deviceId === deviceId);
  const interfaces = selectedDevice?.interfaces || [];
  const selectedInterface = interfaces.find(i => String(i.ifIndex) === String(ifIndex));

  async function loadDevices() {
    try {
      setLoading(true);
      const result = await getDevices();
      if (result.success) {
        setDevices(result.devices || []);
        setDeviceId(current => current || result.devices?.[0]?.deviceId || "");
      }
    } catch (e) { setError(e.message || "Failed to load devices."); }
    finally { setLoading(false); }
  }

  async function loadHistory() {
    if (!deviceId) return;
    try {
      setHistoryLoading(true);
      const result = await getInterfaceHistory(deviceId, ifIndex || null, hours);
      if (result.success) setSamples(result.samples || []);
    } catch (e) { setError(e.message || "Failed to load interface history."); }
    finally { setHistoryLoading(false); }
  }

  useEffect(() => { loadDevices(); }, []);
  useEffect(() => {
    if (selectedDevice && !ifIndex && interfaces.length) setIfIndex(String(interfaces[0].ifIndex));
  }, [selectedDevice, ifIndex, interfaces]);
  useEffect(() => { loadHistory(); }, [deviceId, ifIndex, hours]);
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    socket.on("device_updated", device => {
      setDevices(current => current.some(d => d.deviceId === device.deviceId) ? current.map(d => d.deviceId === device.deviceId ? device : d) : current);
    });
    return () => socket.disconnect();
  }, []);

  const latest = selectedInterface?.metrics || samples[samples.length - 1] || null;
  const latestHealth = selectedInterface?.metrics?.health || samples[samples.length - 1]?.health || "UNKNOWN";
  const latestCheckedAt = selectedInterface?.metrics?.checkedAt || selectedInterface?.lastCheckedAt || null;
  const pollingSeconds = Math.max(5, Number(selectedDevice?.pollingInterval || 30));
  const sampleAgeSeconds = latestCheckedAt ? (Date.now() - new Date(latestCheckedAt).getTime()) / 1000 : Infinity;
  const stale = !Number.isFinite(sampleAgeSeconds) || sampleAgeSeconds > Math.max(pollingSeconds * 3, 120);

  // A parent-device outage must never be displayed as a healthy interface just
  // because the interface's last successful SNMP sample was UP. Likewise, an
  // old sample is UNKNOWN rather than pretending it is still current.
  const effectiveHealth = selectedDevice?.status === "DOWN"
    ? "DOWN"
    : stale
      ? "UNKNOWN"
      : latestHealth;

  const healthReason = selectedDevice?.status === "DOWN"
    ? "Parent device is DOWN; the interface is considered unavailable until the device recovers."
    : stale
      ? `No fresh SNMP interface sample has been received for ${Number.isFinite(sampleAgeSeconds) ? Math.round(sampleAgeSeconds) : "an unknown number of"} seconds.`
      : selectedInterface?.metrics?.healthReasons?.join(" ") || "No active health warning.";

  const maxUtilization = useMemo(() => Math.max(0, ...samples.map(s => Number(s.utilizationPercent || 0))), [samples]);
  const avgUtilization = useMemo(() => samples.length ? samples.reduce((sum, s) => sum + Number(s.utilizationPercent || 0), 0) / samples.length : 0, [samples]);

  return <section className="mx-auto max-w-[1600px] px-6 pb-8">
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="flex items-center gap-2"><Activity size={18} className="text-blue-400"/><h2 className="text-lg font-semibold text-white">Interface Health & Slow-Link Detection</h2></div><p className="mt-1 text-xs text-slate-500">Live health scoring, congestion detection, historical utilization and error analysis.</p></div>
        <button onClick={loadDevices} className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800"><RefreshCw size={14}/>Refresh Devices</button>
      </div>
      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{error}</div>}
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <select value={deviceId} onChange={e => { setDeviceId(e.target.value); setIfIndex(""); }} className="form-input"><option value="">Select device</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.hostname} — {d.ipAddress}</option>)}</select>
        <select value={ifIndex} onChange={e => setIfIndex(e.target.value)} disabled={!interfaces.length} className="form-input"><option value="">Select interface</option>{interfaces.map(i => <option key={i.ifIndex} value={i.ifIndex}>{i.name}</option>)}</select>
        <select value={hours} onChange={e => setHours(Number(e.target.value))} className="form-input"><option value="1">Last 1 hour</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option><option value="72">Last 3 days</option><option value="168">Last 7 days</option></select>
      </div>

      {!selectedDevice ? <div className="py-12 text-center text-sm text-slate-600">{loading ? "Loading devices..." : "Select a monitored device."}</div> : <>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`rounded-lg border p-4 ${healthStyles[effectiveHealth] || healthStyles.UNKNOWN}`}><p className="text-xs opacity-70">Health</p><p className="mt-1 text-lg font-bold">{effectiveHealth}</p><p className="mt-1 text-xs opacity-70">{healthReason}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Link Speed</p><p className="mt-1 text-lg font-semibold text-white">{speed(latest?.speedMbps)}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Current Traffic</p><p className="mt-1 text-sm font-semibold text-slate-300">↓ {rate(latest?.inBps)} · ↑ {rate(latest?.outBps)}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Utilization</p><p className="mt-1 text-lg font-semibold text-white">{effectiveHealth === "DOWN" || effectiveHealth === "UNKNOWN" || latest?.utilizationPercent == null ? "—" : `${Number(latest.utilizationPercent).toFixed(1)}%`}</p></div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-white">Utilization History</h3><p className="text-xs text-slate-600">{samples.length} samples · {hours}h window</p></div>{historyLoading && <RefreshCw size={14} className="animate-spin text-slate-500"/>}</div><MiniChart samples={samples}/><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><span className="text-slate-600">Average</span><p className="mt-1 text-slate-300">{avgUtilization.toFixed(1)}%</p></div><div><span className="text-slate-600">Peak</span><p className="mt-1 text-slate-300">{maxUtilization.toFixed(1)}%</p></div></div></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><h3 className="text-sm font-semibold text-white">Troubleshooting Signals</h3><div className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><span className="text-slate-600">Errors</span><span className="text-slate-300">{(latest?.inErrors || 0) + (latest?.outErrors || 0)}</span></div><div className="flex justify-between"><span className="text-slate-600">Discards</span><span className="text-slate-300">{(latest?.inDiscards || 0) + (latest?.outDiscards || 0)}</span></div><div className="flex justify-between"><span className="text-slate-600">Duplex</span><span className="text-slate-300">{latest?.duplex || "UNKNOWN"}</span></div><div className="flex justify-between"><span className="text-slate-600">Sample interval</span><span className="text-slate-300">{latest?.sampleIntervalSeconds ? `${Number(latest.sampleIntervalSeconds).toFixed(1)}s` : "—"}</span></div><div className="mt-4 border-t border-slate-800 pt-3 text-slate-500"><AlertTriangle size={14} className="mb-2 text-orange-400"/>{healthReason}</div></div></div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">{effectiveHealth === "DOWN" ? <WifiOff size={16} className="text-red-400"/> : <Wifi size={16} className="text-green-400"/>}<p className="mt-2 text-xs text-slate-600">Interface State</p><p className="mt-1 text-sm text-slate-300">{effectiveHealth === "DOWN" ? "DOWN" : stale ? "UNKNOWN" : selectedInterface?.status || "UNKNOWN"}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><WifiOff size={16} className="text-red-400"/><p className="mt-2 text-xs text-slate-600">Active Incident</p><p className="mt-1 text-sm text-slate-300">{latest?.activeIncidentId || (selectedDevice?.activeIncidentId ? selectedDevice.activeIncidentId : "None")}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><Server size={16} className="text-blue-400"/><p className="mt-2 text-xs text-slate-600">Device</p><p className="mt-1 text-sm text-slate-300">{selectedDevice.hostname}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><Activity size={16} className="text-purple-400"/><p className="mt-2 text-xs text-slate-600">Health Score</p><p className="mt-1 text-sm text-slate-300">{effectiveHealth === "DOWN" ? "0/100" : latest?.healthScore == null || stale ? "—" : `${latest.healthScore}/100`}</p></div>
        </div>
      </>}
    </div>
  </section>;
}
