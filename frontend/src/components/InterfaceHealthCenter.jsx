import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Cable, Cpu, Eye, EyeOff, Fingerprint, Flag, Hash, MemoryStick, RefreshCw, Server, Timer, Wifi, WifiOff } from "lucide-react";
import { io } from "socket.io-client";
import { getDevices, getInterfaceHistory, discoverDeviceInterfaces, setInterfaceMonitored, getSystemHealthHistory } from "../services/api";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const healthStyles = {
  HEALTHY: "text-green-400 border-green-500/30 bg-green-500/5",
  WARNING: "text-yellow-400 border-yellow-500/30 bg-yellow-500/5",
  DEGRADED: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  CRITICAL: "text-red-400 border-red-500/30 bg-red-500/5",
  DOWN: "text-red-400 border-red-500/30 bg-red-500/5",
  ADMIN_DOWN: "text-slate-400 border-slate-700 bg-slate-900",
  UNMONITORED: "text-slate-500 border-slate-800 bg-slate-950",
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

function perMin(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(2)}/min`;
}

// Colors a rate/count against warning+critical thresholds - shared by the
// error rate and discard rate signals so both read consistently against
// whatever this device's alertThresholds say "concerning" means.
function toneForRate(value, warning, critical) {
  if (value == null || !Number.isFinite(Number(value))) return "text-slate-500";
  const n = Number(value);
  if (n >= critical) return "text-red-400";
  if (n >= warning) return "text-orange-400";
  return "text-slate-300";
}

function countdown(untilIso) {
  if (!untilIso) return null;
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Generic sparkline: reused for interface utilization and for device CPU/
// memory trends, keyed off whichever field the caller cares about.
function MiniChart({ samples, valueKey = "utilizationPercent", emptyLabel = "No values have been recorded yet.", suffix = "%" }) {
  const points = samples
    .map(sample => ({ value: Number(sample[valueKey]), at: sample.sampledAt || sample.checkedAt || sample.createdAt }))
    .filter(point => Number.isFinite(point.value));

  if (!points.length) return <div className="flex h-40 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/70 text-xs text-slate-600">{emptyLabel}</div>;

  const width = 900;
  const height = 150;
  const padX = 10;
  const padY = 10;
  const max = Math.max(1, ...points.map(point => point.value));
  const min = Math.min(0, ...points.map(point => point.value));
  const range = Math.max(1, max - min);
  const path = points.map((point, index) => {
    const x = padX + (index / Math.max(1, points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((point.value - min) / range) * (height - padY * 2);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

  const latest = points[points.length - 1];
  const peak = Math.max(...points.map(point => point.value));
  const average = points.reduce((sum, point) => sum + point.value, 0) / points.length;

  return <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
    <div className="relative h-40 w-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between text-[10px] text-slate-700">
        <span>{max.toFixed(1)}{suffix}</span><span>{(max * 0.5).toFixed(1)}{suffix}</span><span>0{suffix}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full pl-8">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="currentColor" className="text-slate-800" />
        <line x1={padX} y1={height / 2} x2={width - padX} y2={height / 2} stroke="currentColor" strokeDasharray="4 6" className="text-slate-900" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" className="text-blue-400" />
      </svg>
    </div>
    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600">
      <span>{points[0].at ? new Date(points[0].at).toLocaleTimeString() : "Start"}</span>
      <span>Latest {latest.value.toFixed(2)}{suffix} · Peak {peak.toFixed(2)}{suffix} · Avg {average.toFixed(2)}{suffix}</span>
      <span>{latest.at ? new Date(latest.at).toLocaleTimeString() : "Now"}</span>
    </div>
  </div>;
}

// Compact horizontal gauge for a single system-health metric (CPU/memory) -
// current value plotted against warning/critical thresholds so it's clear
// at a glance how close a device is to trouble, without needing history.
function SystemMetricCard({ icon: Icon, label, value, health, warning, critical, reasons }) {
  const pct = Number.isFinite(Number(value)) ? Math.min(100, Number(value)) : null;
  const barTone = health === "CRITICAL" ? "bg-red-500" : health === "WARNING" || health === "DEGRADED" ? "bg-orange-400" : pct == null ? "bg-slate-700" : "bg-emerald-500";
  return <div className={`rounded-lg border p-4 ${healthStyles[health] || healthStyles.UNKNOWN}`}>
    <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Icon size={15} /><span className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span></div><span className="text-lg font-bold">{pct == null ? "—" : `${pct.toFixed(1)}%`}</span></div>
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${barTone}`} style={{ width: `${pct ?? 0}%` }} /></div>
    <div className="mt-2 flex justify-between text-[10px] opacity-60"><span>Warning {warning ?? "—"}%</span><span>Critical {critical ?? "—"}%</span></div>
    {reasons?.length > 0 && <p className="mt-2 text-[11px] opacity-80">{reasons.join(" ")}</p>}
  </div>;
}

export default function InterfaceHealthCenter() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [ifIndex, setIfIndex] = useState("");
  const [hours, setHours] = useState(24);
  const [samples, setSamples] = useState([]);
  const [systemHistory, setSystemHistory] = useState({ cpu: [], memory: [] });
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [monitoredBusy, setMonitoredBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedDevice = devices.find(d => d.deviceId === deviceId);
  const interfaces = selectedDevice?.interfaces || [];
  const selectedInterface = interfaces.find(i => String(i.ifIndex) === String(ifIndex));

  async function loadDevices({ keepSelection = true } = {}) {
    try {
      setLoading(true);
      setError("");
      const result = await getDevices();
      if (!result.success) throw new Error(result.message || "Failed to load devices.");
      setDevices(result.devices || []);
      if (!keepSelection) setDeviceId("");
      else setDeviceId(current => current || result.devices?.[0]?.deviceId || "");
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Unable to reach the NetEscalate API.");
    } finally { setLoading(false); }
  }

  async function discoverSelectedDevice() {
    if (!selectedDevice || discovering) return;
    try {
      setDiscovering(true);
      setError("");
      setSamples([]);
      setIfIndex("");
      const result = await discoverDeviceInterfaces(selectedDevice.deviceId);
      if (!result.success) throw new Error(result.message || "Interface discovery failed.");

      const discoveredInterfaces = Array.isArray(result.interfaces) ? result.interfaces : [];
      setDevices(current => current.map(device => device.deviceId === selectedDevice.deviceId
        ? { ...device, interfaces: discoveredInterfaces }
        : device
      ));

      if (!discoveredInterfaces.length) {
        setError("SNMP discovery completed but returned no interfaces. Verify SNMP is enabled and the community/credentials are correct.");
        return;
      }

      setIfIndex(String(discoveredInterfaces[0].ifIndex));
      await loadDevices();
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Unable to discover interfaces. Check SNMP connectivity and credentials.");
    } finally {
      setDiscovering(false);
    }
  }

  async function loadHistory() {
    if (!deviceId || !ifIndex) {
      setSamples([]);
      return;
    }
    try {
      setHistoryLoading(true);
      setError("");
      const result = await getInterfaceHistory(deviceId, ifIndex, hours);
      if (!result.success) throw new Error(result.message || "Failed to load interface history.");
      setSamples(Array.isArray(result.samples) ? result.samples : []);
    } catch (e) {
      setSamples([]);
      setError(e.response?.data?.message || e.message || "Unable to load interface history.");
    } finally { setHistoryLoading(false); }
  }

  async function loadSystemHistory() {
    if (!deviceId) {
      setSystemHistory({ cpu: [], memory: [] });
      return;
    }
    try {
      const [cpuResult, memoryResult] = await Promise.all([
        getSystemHealthHistory(deviceId, "cpu", hours),
        getSystemHealthHistory(deviceId, "memory", hours)
      ]);
      setSystemHistory({
        cpu: cpuResult?.success ? cpuResult.samples || [] : [],
        memory: memoryResult?.success ? memoryResult.samples || [] : []
      });
    } catch {
      setSystemHistory({ cpu: [], memory: [] });
    }
  }

  async function toggleMonitored() {
    if (!selectedDevice || !selectedInterface || monitoredBusy) return;
    const next = !(selectedInterface.monitored !== false);
    setMonitoredBusy(true);
    try {
      const result = await setInterfaceMonitored(selectedDevice.deviceId, selectedInterface.ifIndex, next);
      if (!result.success) throw new Error(result.message || "Failed to update monitoring.");
      setDevices(current => current.map(device => device.deviceId !== selectedDevice.deviceId ? device : {
        ...device,
        interfaces: device.interfaces.map(i => String(i.ifIndex) === String(selectedInterface.ifIndex) ? { ...i, monitored: next } : i)
      }));
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Unable to update the monitored flag.");
    } finally {
      setMonitoredBusy(false);
    }
  }

  useEffect(() => { loadDevices(); }, []);
  useEffect(() => {
    if (selectedDevice && (!ifIndex || !interfaces.some(i => String(i.ifIndex) === String(ifIndex))) && interfaces.length) {
      setIfIndex(String(interfaces[0].ifIndex));
    }
  }, [selectedDevice, ifIndex, interfaces]);
  useEffect(() => { loadHistory(); }, [deviceId, ifIndex, hours]);
  useEffect(() => { loadSystemHistory(); }, [deviceId, hours]);
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket", "polling"], withCredentials: true });
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
  const isSilenced = ["ADMIN_DOWN", "UNMONITORED"].includes(latestHealth);

  const effectiveHealth = selectedDevice?.status === "DOWN"
    ? "DOWN"
    : stale && !isSilenced
      ? "UNKNOWN"
      : latestHealth;

  const healthReason = selectedDevice?.status === "DOWN"
    ? "Parent device is DOWN; the interface is considered unavailable until the device recovers."
    : stale && !isSilenced
      ? `No fresh SNMP interface sample has been received for ${Number.isFinite(sampleAgeSeconds) ? Math.round(sampleAgeSeconds) : "an unknown number of"} seconds.`
      : selectedInterface?.metrics?.healthReasons?.join(" ") || "No active health warning.";

  const utilizationValues = useMemo(() => samples.map(s => Number(s.utilizationPercent)).filter(Number.isFinite), [samples]);
  const maxUtilization = useMemo(() => utilizationValues.length ? Math.max(...utilizationValues) : 0, [utilizationValues]);
  const avgUtilization = useMemo(() => utilizationValues.length ? utilizationValues.reduce((sum, value) => sum + value, 0) / utilizationValues.length : 0, [utilizationValues]);

  const thresholds = selectedDevice?.alertThresholds || {};
  const errorsTotal = (latest?.inErrors || 0) + (latest?.outErrors || 0);
  const discardsTotal = (latest?.inDiscards || 0) + (latest?.outDiscards || 0);
  const errorRate = latest?.errorRatePerMin;
  const discardRate = latest?.discardRatePerMin;
  const flap = selectedInterface?.flap;
  const flapWindowMinutes = thresholds.flapWindowMinutes ?? 10;
  const flapCountThreshold = thresholds.flapCountThreshold ?? 4;
  const flapSuppressed = countdown(flap?.cooldownUntil);
  const cpu = selectedDevice?.systemHealth?.cpu;
  const memory = selectedDevice?.systemHealth?.memory;

  const incidentRows = [
    { label: "Status", id: latest?.activeIncidentId },
    { label: "Degradation", id: latest?.degradationIncidentId },
    { label: "Flap", id: flap?.incidentId }
  ].filter(row => row.id);

  return <section className="mx-auto max-w-[1600px] px-6 pb-8">
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="flex items-center gap-2"><Activity size={18} className="text-blue-400"/><h2 className="text-lg font-semibold text-white">Interface Health & Slow-Link Detection</h2></div><p className="mt-1 text-xs text-slate-500">Live health scoring, congestion detection, historical utilization and error analysis.</p></div>
        <button onClick={() => loadDevices()} disabled={loading || discovering} className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800 disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""}/>Refresh Devices</button>
      </div>
      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{error}</div>}
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <select value={deviceId} onChange={e => { setDeviceId(e.target.value); setIfIndex(""); setSamples([]); }} className="form-input"><option value="">Select device</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.hostname} — {d.ipAddress}</option>)}</select>
        <select value={ifIndex} onChange={e => setIfIndex(e.target.value)} disabled={!interfaces.length || discovering} className="form-input"><option value="">{interfaces.length ? "Select interface" : "No interfaces discovered"}</option>{interfaces.map(i => <option key={i.ifIndex} value={i.ifIndex}>{i.name}{i.monitored === false ? " (unmonitored)" : ""}</option>)}</select>
        <select value={hours} onChange={e => setHours(Number(e.target.value))} className="form-input"><option value="1">Last 1 hour</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option><option value="72">Last 3 days</option><option value="168">Last 7 days</option></select>
        <button onClick={discoverSelectedDevice} disabled={!selectedDevice || discovering} title={interfaces.length ? "Refresh interfaces from the device" : "Fetch interfaces from the device"} className="flex items-center justify-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"><Cable size={14} className={discovering ? "animate-pulse" : ""}/>{discovering ? "Fetching..." : interfaces.length ? "Refresh Interfaces" : "Fetch Interfaces"}</button>
      </div>
      {selectedDevice && !interfaces.length && !discovering && <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs"><div><p className="font-medium text-blue-300">No interfaces are loaded for {selectedDevice.hostname}.</p><p className="mt-1 text-slate-500">Fetch them directly over SNMP to populate Interface Health and historical monitoring.</p></div><button onClick={discoverSelectedDevice} className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-500">Fetch now</button></div>}

      {!selectedDevice ? <div className="py-12 text-center text-sm text-slate-600">{loading ? "Loading devices..." : "Select a monitored device."}</div> : <>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`rounded-lg border p-4 ${healthStyles[effectiveHealth] || healthStyles.UNKNOWN}`}><p className="text-xs opacity-70">Health</p><p className="mt-1 text-lg font-bold">{effectiveHealth}</p><p className="mt-1 text-xs opacity-70">{healthReason}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Link Speed</p><p className="mt-1 text-lg font-semibold text-white">{speed(latest?.speedMbps)}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Current Traffic</p><p className="mt-1 text-sm font-semibold text-slate-300">↓ {rate(latest?.inBps)} · ↑ {rate(latest?.outBps)}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Utilization</p><p className="mt-1 text-lg font-semibold text-white">{effectiveHealth === "DOWN" || effectiveHealth === "UNKNOWN" || latest?.utilizationPercent == null ? "—" : `${Number(latest.utilizationPercent).toFixed(1)}%`}</p></div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-white">Utilization History</h3><p className="text-xs text-slate-600">{samples.length} samples · {hours}h window</p></div>{historyLoading && <RefreshCw size={14} className="animate-spin text-slate-500"/>}</div><MiniChart samples={samples}/><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><span className="text-slate-600">Average</span><p className="mt-1 text-slate-300">{avgUtilization.toFixed(2)}%</p></div><div><span className="text-slate-600">Peak</span><p className="mt-1 text-slate-300">{maxUtilization.toFixed(2)}%</p></div></div></div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">Troubleshooting Signals</h3>{selectedInterface && <button onClick={toggleMonitored} disabled={monitoredBusy} title={selectedInterface.monitored === false ? "Re-enable alerting for this interface" : "Silence alerting for this interface"} className="flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-800 disabled:opacity-50">{selectedInterface.monitored === false ? <EyeOff size={12}/> : <Eye size={12}/>}{selectedInterface.monitored === false ? "Unmonitored" : "Monitored"}</button>}</div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-slate-600">Errors (in+out)</span><span className={toneForRate(errorRate, thresholds.errorRateWarningPerMin ?? 5, thresholds.errorRateCriticalPerMin ?? 30)}>{errorsTotal.toLocaleString()} total · {perMin(errorRate)}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Discards (in+out)</span><span className={toneForRate(discardRate, thresholds.errorRateWarningPerMin ?? 5, thresholds.errorRateCriticalPerMin ?? 30)}>{discardsTotal.toLocaleString()} total · {perMin(discardRate)}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Duplex</span><span className={latest?.duplex === "HALF" ? "text-orange-400" : "text-slate-300"}>{latest?.duplex || "UNKNOWN"}{latest?.duplex === "HALF" && " (check for mismatch)"}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Counter source</span><span className="text-slate-300">{latest?.octetSource === "HC" ? "64-bit (HC)" : latest?.octetSource === "legacy" ? "32-bit (legacy)" : "—"}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-slate-600"><Timer size={11}/>Sample interval</span><span className="text-slate-300">{latest?.sampleIntervalSeconds ? `${Number(latest.sampleIntervalSeconds).toFixed(1)}s` : "—"}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-slate-600"><Hash size={11}/>MTU</span><span className="text-slate-300">{latest?.mtu || "—"}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-slate-600"><Fingerprint size={11}/>MAC address</span><span className="font-mono text-slate-300">{latest?.macAddress || "—"}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-600">Admin state</span><span className="text-slate-300">{selectedInterface?.adminState || "UNKNOWN"}{selectedInterface?.monitored === false && " · unmonitored"}</span></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-slate-600"><Flag size={11}/>Flap status</span><span className={flapSuppressed ? "text-orange-400" : "text-slate-300"}>{flap?.transitions?.length ?? 0}/{flapCountThreshold} in {flapWindowMinutes}m{flapSuppressed ? ` · suppressed ${flapSuppressed}` : ""}</span></div>

              {incidentRows.length > 0 && <div className="border-t border-slate-800 pt-3"><p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-600">Active incidents</p>{incidentRows.map(row => <div key={row.label} className="flex items-center justify-between"><span className="text-slate-600">{row.label}</span><span className="font-mono text-slate-300">{row.id}</span></div>)}</div>}

              <div className="border-t border-slate-800 pt-3 text-slate-500"><AlertTriangle size={14} className="mb-2 text-orange-400"/>{healthReason}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">{effectiveHealth === "DOWN" ? <WifiOff size={16} className="text-red-400"/> : <Wifi size={16} className="text-green-400"/>}<p className="mt-2 text-xs text-slate-600">Interface State</p><p className="mt-1 text-sm text-slate-300">{effectiveHealth === "DOWN" ? "DOWN" : stale && !isSilenced ? "UNKNOWN" : selectedInterface?.status || "UNKNOWN"}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><WifiOff size={16} className="text-red-400"/><p className="mt-2 text-xs text-slate-600">Active Incidents</p><p className="mt-1 text-sm text-slate-300">{incidentRows.length || (selectedDevice?.activeIncidentId ? 1 : 0) || "None"}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><Server size={16} className="text-blue-400"/><p className="mt-2 text-xs text-slate-600">Device</p><p className="mt-1 text-sm text-slate-300">{selectedDevice.hostname}</p></div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><Activity size={16} className="text-purple-400"/><p className="mt-2 text-xs text-slate-600">Health Score</p><p className="mt-1 text-sm text-slate-300">{effectiveHealth === "DOWN" ? "0/100" : latest?.healthScore == null || (stale && !isSilenced) ? "—" : `${latest.healthScore}/100`}</p></div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center gap-2"><Cpu size={16} className="text-blue-400"/><h3 className="text-sm font-semibold text-white">Device System Health</h3><p className="text-xs text-slate-600">{selectedDevice.hostname} · CPU and memory pressure, independent of the selected interface</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SystemMetricCard icon={Cpu} label="CPU" value={cpu?.utilizationPercent} health={cpu?.health || "UNKNOWN"} warning={thresholds.cpuWarning ?? 80} critical={thresholds.cpuCritical ?? 95} reasons={cpu?.healthReasons} />
            <SystemMetricCard icon={MemoryStick} label="Memory" value={memory?.utilizationPercent} health={memory?.health || "UNKNOWN"} warning={thresholds.memoryWarning ?? 80} critical={thresholds.memoryCritical ?? 95} reasons={memory?.healthReasons} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MiniChart samples={systemHistory.cpu} valueKey="utilizationPercent" emptyLabel="No CPU history recorded yet." />
            <MiniChart samples={systemHistory.memory} valueKey="utilizationPercent" emptyLabel="No memory history recorded yet." />
          </div>
        </div>
      </>}
    </div>
  </section>;
}
