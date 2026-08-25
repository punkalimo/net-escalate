import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity, AlertTriangle, Phone, CheckCircle2, Server, Plus,
  RefreshCw, X, Clock, User, MapPin, ChevronRight, Check,
  PhoneCall, AlertCircle, Router, Monitor, Wifi, WifiOff,
  Settings, Search, Network, Shield, CircleDot, Pencil, Trash2,
  Save
} from "lucide-react";

import {
  getIncidents,
  createIncident,
  getTechnicians,
  resolveIncident,
  getDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  testDevicePort,
  testDeviceConnectivity,
  discoverDeviceInterfaces,
  getDeviceInterfaces
} from "./services/api";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function StatCard({ title, value, icon: Icon, description }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-400">{title}</p>
        <p className="mt-2 text-3xl font-bold text-white">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="rounded-lg bg-slate-800 p-3"><Icon size={22} className="text-slate-300" /></div>
    </div>
  </div>;
}

function SeverityBadge({ severity }) {
  const styles = {
    critical: "bg-red-500/10 text-red-400 border-red-500/30",
    high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    low: "bg-blue-500/10 text-blue-400 border-blue-500/30"
  };
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${styles[severity] || styles.medium}`}>{severity}</span>;
}

function StatusBadge({ status }) {
  const styles = {
    OPEN: "text-blue-400", CALLING: "text-purple-400", ACKNOWLEDGED: "text-green-400",
    ESCALATING: "text-orange-400", RESOLVED: "text-slate-400", FAILED: "text-red-400",
    UP: "text-green-400", DOWN: "text-red-400", DEGRADED: "text-orange-400", UNKNOWN: "text-yellow-400"
  };
  return <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full bg-current ${styles[status] || "text-slate-400"}`} /><span className={`text-xs font-medium ${styles[status] || "text-slate-400"}`}>{status}</span></div>;
}

function DeviceStatusBadge({ status }) {
  if (status === "UP") return <div className="flex items-center gap-2 text-green-400"><Wifi size={15}/><span className="text-xs font-semibold">ONLINE</span></div>;
  if (status === "DOWN") return <div className="flex items-center gap-2 text-red-400"><WifiOff size={15}/><span className="text-xs font-semibold">OFFLINE</span></div>;
  if (status === "DEGRADED") return <div className="flex items-center gap-2 text-orange-400"><AlertTriangle size={15}/><span className="text-xs font-semibold">DEGRADED</span></div>;
  return <div className="flex items-center gap-2 text-yellow-400"><CircleDot size={15}/><span className="text-xs font-semibold">UNKNOWN</span></div>;
}

function DeviceIcon({ type }) {
  if (type === "router") return <Router size={20} className="text-blue-400"/>;
  if (type === "switch") return <Network size={20} className="text-purple-400"/>;
  if (type === "firewall") return <Shield size={20} className="text-orange-400"/>;
  if (type === "server") return <Server size={20} className="text-green-400"/>;
  return <Monitor size={20} className="text-slate-400"/>;
}

function FormField({ label, required, children }) {
  return <div><label className="mb-2 block text-xs font-medium text-slate-400">{label}{required && <span className="ml-1 text-red-400">*</span>}</label>{children}</div>;
}

const emptyDevice = {
  hostname: "", ipAddress: "", deviceType: "router", vendor: "", model: "", location: "",
  description: "", monitoringEnabled: true, pollingInterval: 30, snmpVersion: "2c", community: "public"
};

function DeviceFormModal({ device, onClose, onSaved }) {
  const editing = Boolean(device);
  const [form, setForm] = useState(() => device ? {
    hostname: device.hostname || "", ipAddress: device.ipAddress || "", deviceType: device.deviceType || "other",
    vendor: device.vendor || "", model: device.model || "", location: device.location || "", description: device.description || "",
    monitoringEnabled: device.monitoringEnabled !== false, pollingInterval: device.pollingInterval || 30,
    snmpVersion: device.snmp?.version || "2c", community: device.snmp?.community || "public"
  } : emptyDevice);
  const [saving, setSaving] = useState(false);

  const update = (field, value) => setForm(current => ({ ...current, [field]: value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        hostname: form.hostname.trim(), ipAddress: form.ipAddress.trim(), deviceType: form.deviceType,
        vendor: form.vendor.trim(), model: form.model.trim(), location: form.location.trim(), description: form.description.trim(),
        monitoringEnabled: form.monitoringEnabled, pollingInterval: Number(form.pollingInterval),
        snmp: {
          enabled: true, version: form.snmpVersion, community: form.community,
          username: "", securityLevel: "noAuthNoPriv", authProtocol: "", authKey: "", privProtocol: "", privKey: ""
        }
      };
      const result = editing ? await updateDevice(device.deviceId, payload) : await createDevice(payload);
      if (!result.success) throw new Error(result.message || "Operation failed.");
      onSaved(result.device);
      onClose();
    } catch (error) {
      alert(error.response?.data?.message || error.message || "Failed to save device.");
    } finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div><h3 className="font-semibold text-white">{editing ? "Edit Network Device" : "Add Network Device"}</h3><p className="mt-1 text-xs text-slate-500">{editing ? "Update device identity and monitoring settings." : "Register a device for monitoring."}</p></div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={20}/></button>
      </div>
      <form onSubmit={submit} className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Hostname" required><input required value={form.hostname} onChange={e=>update("hostname",e.target.value)} placeholder="CORE-SW-01" className="form-input"/></FormField>
          <FormField label="IP Address" required><input required value={form.ipAddress} onChange={e=>update("ipAddress",e.target.value)} placeholder="192.168.1.1" className="form-input"/></FormField>
          <FormField label="Device Type"><select value={form.deviceType} onChange={e=>update("deviceType",e.target.value)} className="form-input"><option value="router">Router</option><option value="switch">Switch</option><option value="firewall">Firewall</option><option value="server">Server</option><option value="access-point">Access Point</option><option value="other">Other</option></select></FormField>
          <FormField label="Vendor"><input value={form.vendor} onChange={e=>update("vendor",e.target.value)} placeholder="Cisco, Huawei, ZTE..." className="form-input"/></FormField>
          <FormField label="Model"><input value={form.model} onChange={e=>update("model",e.target.value)} placeholder="Catalyst 2960" className="form-input"/></FormField>
          <FormField label="Location"><input value={form.location} onChange={e=>update("location",e.target.value)} placeholder="Lusaka HQ" className="form-input"/></FormField>
        </div>
        <FormField label="Description"><textarea rows="3" value={form.description} onChange={e=>update("description",e.target.value)} className="form-input resize-none" placeholder="Core network switch..."/></FormField>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <div className="mb-4 flex items-center gap-2"><Settings size={17} className="text-slate-400"/><h4 className="font-medium text-white">Monitoring</h4></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Polling Interval"><select value={form.pollingInterval} onChange={e=>update("pollingInterval",e.target.value)} className="form-input"><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="300">5 minutes</option><option value="600">10 minutes</option></select></FormField>
            <div className="flex items-end"><label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={form.monitoringEnabled} onChange={e=>update("monitoringEnabled",e.target.checked)} className="h-4 w-4"/><span className="text-sm text-slate-300">Enable monitoring</span></label></div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <div className="mb-4 flex items-center gap-2"><Network size={17} className="text-slate-400"/><h4 className="font-medium text-white">SNMP</h4></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="SNMP Version"><select value={form.snmpVersion} onChange={e=>update("snmpVersion",e.target.value)} className="form-input"><option value="2c">SNMP v2c</option><option value="1">SNMP v1</option><option value="3">SNMP v3</option></select></FormField>
            <FormField label="Community"><input value={form.community} onChange={e=>update("community",e.target.value)} placeholder="public" className="form-input"/></FormField>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-600">SNMP credentials are stored with the device configuration and can be used by the monitoring engine when SNMP polling is enabled.</p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><Save size={17}/>{saving ? "Saving..." : editing ? "Save Changes" : "Add Device"}</button>
        </div>
      </form>
    </div>
  </div>;
}

function formatRate(bitsPerSecond) {
  if (bitsPerSecond == null || !Number.isFinite(bitsPerSecond)) return "—";
  if (bitsPerSecond >= 1e9) return `${(bitsPerSecond / 1e9).toFixed(2)} Gbps`;
  if (bitsPerSecond >= 1e6) return `${(bitsPerSecond / 1e6).toFixed(2)} Mbps`;
  if (bitsPerSecond >= 1e3) return `${(bitsPerSecond / 1e3).toFixed(1)} Kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
}

function formatSpeed(speedMbps) {
  if (speedMbps == null || !Number.isFinite(speedMbps)) return "N/A";
  if (speedMbps >= 1000) return `${(speedMbps / 1000).toFixed(speedMbps % 1000 === 0 ? 0 : 2)} Gbps`;
  return `${speedMbps} Mbps`;
}

function InterfaceMetrics({ item }) {
  const metrics = item.metrics;
  if (!metrics) return <p className="mt-3 text-xs text-slate-600">Performance metrics unavailable.</p>;
  const totalErrors = (metrics.inErrors || 0) + (metrics.outErrors || 0);
  const totalDiscards = (metrics.inDiscards || 0) + (metrics.outDiscards || 0);
  return <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
    <div><p className="text-slate-600">Speed</p><p className="mt-1 text-slate-300">{formatSpeed(metrics.speedMbps)}</p></div>
    <div><p className="text-slate-600">Duplex</p><p className="mt-1 text-slate-300">{metrics.duplex || "UNKNOWN"}</p></div>
    <div><p className="text-slate-600">In</p><p className="mt-1 text-slate-300">{formatRate(metrics.inBps)}</p></div>
    <div><p className="text-slate-600">Out</p><p className="mt-1 text-slate-300">{formatRate(metrics.outBps)}</p></div>
    <div><p className="text-slate-600">Utilization</p><p className="mt-1 font-semibold text-slate-300">{metrics.utilizationPercent == null ? "—" : `${metrics.utilizationPercent.toFixed(1)}%`}</p></div>
    <div><p className="text-slate-600">Errors / Discards</p><p className={`mt-1 ${totalErrors || totalDiscards ? "text-orange-400" : "text-slate-300"}`}>{totalErrors} / {totalDiscards}</p></div>
  </div>;
}

function DeviceDetails({ device, onClose, onEdit, onDelete, onRefresh }) {
  const [port, setPort] = useState("80");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [interfaces, setInterfaces] = useState(device.interfaces || []);
  const [discovering, setDiscovering] = useState(false);
  const [interfaceError, setInterfaceError] = useState(null);

  useEffect(() => {
    setInterfaces(device.interfaces || []);
  }, [device.interfaces]);

  async function loadInterfaces() {
    try {
      const result = await getDeviceInterfaces(device.deviceId);
      if (result.success) setInterfaces(result.interfaces || []);
    } catch (error) {
      setInterfaceError(error.response?.data?.message || error.message || "Failed to load interfaces.");
    }
  }

  async function discover() {
    setDiscovering(true);
    setInterfaceError(null);
    try {
      const result = await discoverDeviceInterfaces(device.deviceId);
      if (!result.success) throw new Error(result.message || "Interface discovery failed.");
      setInterfaces(result.interfaces || []);
      if (onRefresh) await onRefresh();
    } catch (error) {
      setInterfaceError(error.response?.data?.message || error.message || "Failed to discover interfaces.");
    } finally {
      setDiscovering(false);
    }
  }

  async function runTest(connectivity = false) {
    setTesting(true); setTestResult(null);
    try {
      const result = connectivity ? await testDeviceConnectivity(device.deviceId, Number(port)) : await testDevicePort(device.deviceId, Number(port));
      setTestResult(result); if (onRefresh) await onRefresh();
    } catch (error) { setTestResult({success:false,message:error.response?.data?.message || "Test failed."}); }
    finally { setTesting(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3"><div className="rounded-lg bg-slate-800 p-2"><DeviceIcon type={device.deviceType}/></div><div><h3 className="font-semibold text-white">{device.hostname}</h3><p className="font-mono text-xs text-slate-500">{device.deviceId}</p></div></div>
        <div className="flex items-center gap-2"><button onClick={onEdit} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800"><Pencil size={14}/>Edit</button><button onClick={onDelete} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10"><Trash2 size={14}/>Delete</button><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={20}/></button></div>
      </div>
      <div className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoBox icon={Network} title="IP Address" value={device.ipAddress}/><InfoBox icon={Server} title="Vendor" value={device.vendor || "Unknown"}/><InfoBox icon={Settings} title="Model" value={device.model || "Unknown"}/><InfoBox icon={MapPin} title="Location" value={device.location || "Unknown"}/>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5"><h4 className="font-semibold text-white">Device Status</h4><div className="mt-4 flex items-center justify-between"><DeviceStatusBadge status={device.status}/><span className="text-xs text-slate-600">Monitoring {device.monitoringEnabled ? "Enabled" : "Disabled"}</span></div><div className="mt-5 space-y-3"><div><p className="text-xs text-slate-600">Last poll</p><p className="mt-1 text-sm text-slate-300">{device.lastPollAt ? new Date(device.lastPollAt).toLocaleString() : "Never"}</p></div><div><p className="text-xs text-slate-600">Last seen</p><p className="mt-1 text-sm text-slate-300">{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never"}</p></div><div><p className="text-xs text-slate-600">Polling interval</p><p className="mt-1 text-sm text-slate-300">{device.pollingInterval || 30} seconds</p></div></div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5"><h4 className="font-semibold text-white">Connectivity Test</h4><p className="mt-1 text-xs text-slate-600">Check whether a TCP service is available.</p><div className="mt-4 flex gap-2"><input type="number" min="1" max="65535" value={port} onChange={e=>setPort(e.target.value)} className="form-input"/><button onClick={()=>runTest(false)} disabled={testing} className="rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">Test Port</button></div><button onClick={()=>runTest(true)} disabled={testing} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"><Wifi size={15}/>Test Connectivity</button>{testResult && <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Test Result</p><p className={`mt-2 text-sm font-semibold ${testResult.result?.state === "OPEN" ? "text-green-400" : "text-red-400"}`}>{testResult.result?.state || testResult.message || "Unknown"}</p>{testResult.result?.message && <p className="mt-1 text-xs text-slate-500">{testResult.result.message}</p>}</div>}</div>
        </div>
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="font-semibold text-white">Network Interfaces</h4><p className="mt-1 text-xs text-slate-600">Live SNMP status, negotiated speed, traffic and error counters.</p></div><button onClick={discover} disabled={discovering} className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"><RefreshCw size={14} className={discovering ? "animate-spin" : ""}/>{discovering ? "Discovering..." : interfaces.length ? "Refresh Interfaces" : "Discover Interfaces"}</button></div>
          {interfaceError && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">{interfaceError}</div>}
          {!interfaces.length ? <div className="mt-4 rounded-lg border border-dashed border-slate-800 p-6 text-center"><p className="text-sm text-slate-500">No interfaces have been discovered yet.</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2">{interfaces.map((item,index)=><div key={item.ifIndex || `${item.name}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900 p-4"><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm text-white">{item.name}</span><StatusBadge status={item.status}/></div>{item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}<InterfaceMetrics item={item}/></div>)}</div>}
        </div>
      </div>
    </div>
  </div>;
}

function InfoBox({ icon: Icon, title, value }) { return <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-center gap-2 text-xs text-slate-600"><Icon size={14}/>{title}</div><p className="mt-2 text-sm font-medium text-slate-300">{value}</p></div>; }

function IncidentDetails({ incident, onClose, onResolve, resolving }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl"><div className="flex items-center justify-between border-b border-slate-800 px-6 py-4"><div className="flex flex-wrap items-center gap-3"><h3 className="font-mono text-lg font-bold text-white">{incident.incidentId}</h3><SeverityBadge severity={incident.severity}/><StatusBadge status={incident.status}/></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={20}/></button></div><div className="p-6"><div className="grid gap-3 sm:grid-cols-2"><InfoBox icon={Server} title="Device" value={incident.device}/><InfoBox icon={MapPin} title="Location" value={incident.location}/><InfoBox icon={User} title="Technician" value={incident.technician?.name || "Unassigned"}/><InfoBox icon={Activity} title="Escalation Level" value={`Level ${incident.escalationLevel}`}/></div><div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-600">Description</p><p className="mt-2 text-sm leading-6 text-slate-300">{incident.description}</p></div>{incident.acknowledgement && <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/5 p-4"><p className="text-sm font-medium text-green-400">Technician Acknowledgement</p><p className="mt-2 text-sm text-slate-400">{incident.acknowledgement}</p></div>}<div className="mt-6"><h4 className="mb-4 font-semibold text-white">Escalation History</h4><div className="space-y-3">{(incident.escalationHistory || []).map((entry,index)=><div key={index} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-start justify-between"><div className="flex items-start gap-3"><div className="rounded-full bg-purple-500/10 p-2 text-purple-400"><PhoneCall size={16}/></div><div><p className="font-semibold text-white">Level {entry.level} — {entry.status}</p><p className="mt-1 text-sm text-slate-300">{entry.technicianName || "Unknown technician"}</p>{entry.technicianPhone && <p className="mt-1 text-xs text-slate-500">{entry.technicianPhone}</p>}</div></div>{entry.startedAt && <span className="flex items-center gap-1 text-xs text-slate-600"><Clock size={13}/>{new Date(entry.startedAt).toLocaleTimeString()}</span>}</div>{entry.response && <p className="mt-3 text-sm text-slate-400">{entry.response}</p>}</div>)}</div></div>{incident.status !== "RESOLVED" && <button onClick={onResolve} disabled={resolving} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"><CheckCircle2 size={17}/>{resolving ? "Resolving..." : "Resolve Incident"}</button>}</div></div></div>;
}

function DeviceList({ devices, loading, onSelect, onRefresh, onCreate, onEdit, onDelete }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => devices.filter(device => `${device.hostname || ""} ${device.ipAddress || ""} ${device.vendor || ""} ${device.location || ""}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>({DOWN:0,DEGRADED:1,UNKNOWN:2,UP:3}[a.status] ?? 2)-({DOWN:0,DEGRADED:1,UNKNOWN:2,UP:3}[b.status] ?? 2)), [devices,search]);
  return <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"><div className="flex flex-col gap-4 border-b border-slate-800 px-5 py-4 md:flex-row md:items-center md:justify-between"><div><h3 className="font-semibold text-white">Network Devices</h3><p className="text-xs text-slate-500">Devices monitored by NetEscalate</p></div><div className="flex gap-2"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search devices..." className="rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"/></div><button onClick={onRefresh} className="rounded-lg border border-slate-700 bg-slate-900 px-3 hover:bg-slate-800"><RefreshCw size={16}/></button><button onClick={onCreate} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"><Plus size={16}/>Add Device</button></div></div>{loading ? <div className="p-10 text-center text-sm text-slate-500">Loading devices...</div> : !filtered.length ? <div className="p-10 text-center"><Server size={40} className="mx-auto text-slate-700"/><p className="mt-3 font-medium text-white">No devices found</p><p className="mt-1 text-sm text-slate-500">Add a device to start monitoring your infrastructure.</p></div> : <div className="divide-y divide-slate-800">{filtered.map(device=><div key={device.deviceId} className="flex w-full flex-col gap-4 p-5 transition hover:bg-slate-800/30 md:flex-row md:items-center md:justify-between"><button onClick={()=>onSelect(device)} className="flex min-w-0 items-start gap-4 text-left"><div className="rounded-lg bg-slate-800 p-3"><DeviceIcon type={device.deviceType}/></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><span className="font-semibold text-white">{device.hostname}</span><DeviceStatusBadge status={device.status}/></div><p className="mt-1 font-mono text-xs text-slate-500">{device.ipAddress}</p><p className="mt-2 text-sm text-slate-400">{device.vendor || "Unknown vendor"}{device.model && ` • ${device.model}`}</p></div></button><div className="flex items-center gap-3 md:min-w-[430px] md:justify-end"><div><p className="mb-1 text-xs text-slate-600">Location</p><p className="text-sm text-slate-300">{device.location || "Unknown"}</p></div><div><p className="mb-1 text-xs text-slate-600">Last Poll</p><p className="text-sm text-slate-300">{device.lastPollAt ? new Date(device.lastPollAt).toLocaleTimeString() : "Never"}</p></div><button onClick={()=>onEdit(device)} title="Edit device" className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><Pencil size={15}/></button><button onClick={()=>onDelete(device)} title="Delete device" className="rounded-lg border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10"><Trash2 size={15}/></button><ChevronRight size={18} className="text-slate-600"/></div></div>)}</div>}</div>;
}

function App() {
  const [incidents,setIncidents]=useState([]); const [technicians,setTechnicians]=useState([]); const [devices,setDevices]=useState([]);
  const [loading,setLoading]=useState(true); const [devicesLoading,setDevicesLoading]=useState(true); const [socketConnected,setSocketConnected]=useState(false);
  const [activeSection,setActiveSection]=useState("incidents"); const [showCreate,setShowCreate]=useState(false); const [showDeviceForm,setShowDeviceForm]=useState(false);
  const [selectedIncident,setSelectedIncident]=useState(null); const [selectedDevice,setSelectedDevice]=useState(null); const [editingDevice,setEditingDevice]=useState(null); const [resolving,setResolving]=useState(false);
  const [form,setForm]=useState({device:"",location:"",severity:"medium",description:"",technicianId:""});

  async function loadIncidents(){try{setLoading(true);const data=await getIncidents();if(data.success)setIncidents(data.incidents);}catch(e){console.error(e);}finally{setLoading(false);}}
  async function loadTechnicians(){try{const data=await getTechnicians();if(data.success)setTechnicians(data.technicians);}catch(e){console.error(e);}}
  async function loadDevices(){try{setDevicesLoading(true);const data=await getDevices();if(data.success)setDevices(data.devices);}catch(e){console.error(e);}finally{setDevicesLoading(false);}}

  useEffect(()=>{loadIncidents();loadTechnicians();loadDevices();},[]);
  useEffect(()=>{const socket=io(SOCKET_URL,{transports:["websocket","polling"]});socket.on("connect",()=>setSocketConnected(true));socket.on("disconnect",()=>setSocketConnected(false));socket.on("incident_created",incident=>setIncidents(c=>c.some(i=>i.incidentId===incident.incidentId)?c:[incident,...c]));socket.on("incident_updated",incident=>{setIncidents(c=>c.some(i=>i.incidentId===incident.incidentId)?c.map(i=>i.incidentId===incident.incidentId?incident:i):[incident,...c]);setSelectedIncident(c=>c?.incidentId===incident.incidentId?incident:c);});socket.on("device_updated",device=>{setDevices(c=>c.some(d=>d.deviceId===device.deviceId)?c.map(d=>d.deviceId===device.deviceId?device:d):[device,...c]);setSelectedDevice(c=>c?.deviceId===device.deviceId?device:c);});return()=>socket.disconnect();},[]);
  useEffect(()=>{const interval=setInterval(()=>{if(!socketConnected){loadIncidents();loadDevices();}},10000);return()=>clearInterval(interval);},[socketConnected]);

  async function handleCreateIncident(e){e.preventDefault();try{let technician=technicians.find(t=>t.technicianId===form.technicianId)||technicians.find(t=>t.level===1&&t.active);if(!technician)return alert("No active technician is available.");await createIncident({device:form.device,location:form.location,severity:form.severity,description:form.description,technician:{id:technician.technicianId,name:technician.name,phone:technician.phone}});setForm({device:"",location:"",severity:"medium",description:"",technicianId:""});setShowCreate(false);}catch(error){alert(error.response?.data?.message||"Failed to create incident.");}}
  async function handleResolve(){if(!selectedIncident)return;try{setResolving(true);const data=await resolveIncident(selectedIncident.incidentId);if(data.success){setIncidents(c=>c.map(i=>i.incidentId===selectedIncident.incidentId?data.incident:i));setSelectedIncident(data.incident);}}catch(error){alert(error.response?.data?.message||"Failed to resolve incident.");}finally{setResolving(false);}}
  function handleDeviceSaved(device){setDevices(c=>c.some(d=>d.deviceId===device.deviceId)?c.map(d=>d.deviceId===device.deviceId?device:d):[device,...c]);setSelectedDevice(device);}
  async function handleDeleteDevice(device){if(!device)return;if(!window.confirm(`Delete ${device.hostname}? This will stop monitoring and remove the device.`))return;try{const result=await deleteDevice(device.deviceId);if(result.success){setDevices(c=>c.filter(d=>d.deviceId!==device.deviceId));setSelectedDevice(null);setEditingDevice(null);}}catch(error){alert(error.response?.data?.message||"Failed to delete device.");}}
  const active=incidents.filter(i=>i.status!=="RESOLVED"); const critical=active.filter(i=>i.severity==="critical"); const calling=active.filter(i=>i.status==="CALLING"); const acknowledged=active.filter(i=>i.status==="ACKNOWLEDGED"); const online=devices.filter(d=>d.status==="UP"); const offline=devices.filter(d=>d.status==="DOWN");

  return <div className="min-h-screen bg-[#070b12] text-slate-200"><header className="border-b border-slate-800 bg-[#0b111b]"><div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4"><div className="flex items-center gap-3"><div className="rounded-lg bg-blue-600 p-2"><Activity size={22}/></div><div><h1 className="text-lg font-bold tracking-wide">NetEscalate</h1><p className="text-xs text-slate-500">AI Infrastructure Incident Response</p></div></div><div className="flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${socketConnected?"bg-green-400":"bg-yellow-400"}`}/><span className={socketConnected?"text-green-400":"text-yellow-400"}>{socketConnected?"Live":"Reconnecting"}</span></div></div></header>
    <main className="mx-auto max-w-[1600px] p-6"><div className="mb-6 flex gap-2 border-b border-slate-800"><button onClick={()=>setActiveSection("incidents")} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${activeSection==="incidents"?"border-blue-500 text-blue-400":"border-transparent text-slate-500 hover:text-white"}`}><Activity size={16}/>Incidents</button><button onClick={()=>setActiveSection("devices")} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${activeSection==="devices"?"border-blue-500 text-blue-400":"border-transparent text-slate-500 hover:text-white"}`}><Server size={16}/>Devices</button></div>
      {activeSection==="incidents"&&<><div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-bold text-white">Operations Dashboard</h2><p className="mt-1 text-sm text-slate-500">Monitor network incidents and AI escalation activity.</p></div><div className="flex gap-3"><button onClick={loadIncidents} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm hover:bg-slate-800"><RefreshCw size={16}/>Refresh</button><button onClick={()=>setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"><Plus size={17}/>Create Incident</button></div></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"><StatCard title="Active Incidents" value={active.length} icon={Activity} description="Currently requiring attention"/><StatCard title="Critical" value={critical.length} icon={AlertTriangle} description="Highest severity incidents"/><StatCard title="Calls / Escalation" value={calling.length} icon={Phone} description="Currently being escalated"/><StatCard title="Acknowledged" value={acknowledged.length} icon={CheckCircle2} description="Technician accepted"/></div><div className="mt-8 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"><div className="border-b border-slate-800 px-5 py-4"><h3 className="font-semibold text-white">Incidents</h3><p className="text-xs text-slate-500">Real-time escalation updates</p></div>{loading?<div className="p-10 text-center text-sm text-slate-500">Loading incidents...</div>:!incidents.length?<div className="p-10 text-center"><CheckCircle2 size={40} className="mx-auto text-green-500"/><p className="mt-3 font-medium text-white">No incidents</p><p className="mt-1 text-sm text-slate-500">Your infrastructure is currently clear.</p></div>:<div className="divide-y divide-slate-800">{incidents.map(incident=><button key={incident.incidentId} onClick={()=>setSelectedIncident(incident)} className="flex w-full flex-col gap-4 p-5 text-left transition hover:bg-slate-800/30 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap items-center gap-3"><span className="font-mono text-sm font-semibold text-white">{incident.incidentId}</span><SeverityBadge severity={incident.severity}/></div><p className="mt-1 font-medium text-slate-300">{incident.device}</p><p className="mt-1 text-sm text-slate-500">{incident.location}</p><p className="mt-2 max-w-xl text-sm text-slate-400">{incident.description}</p></div><div className="flex items-center gap-6 md:min-w-[420px] md:justify-end"><div><p className="mb-1 text-xs text-slate-600">Technician</p><p className="text-sm text-slate-300">{incident.technician?.name||"Unassigned"}</p></div><div><p className="mb-1 text-xs text-slate-600">Status</p><StatusBadge status={incident.status}/></div><div><p className="mb-1 text-xs text-slate-600">Escalation</p><p className="text-sm text-slate-300">Level {incident.escalationLevel}</p></div><ChevronRight size={18} className="text-slate-600"/></div></button>)}</div>}</div></>}
      {activeSection==="devices"&&<><div className="mb-6"><h2 className="text-2xl font-bold text-white">Network Devices</h2><p className="mt-1 text-sm text-slate-500">Manage and monitor routers, switches, firewalls, servers and other infrastructure.</p></div><div className="mb-6 grid gap-4 md:grid-cols-3"><StatCard title="Total Devices" value={devices.length} icon={Server} description="Registered infrastructure"/><StatCard title="Online" value={online.length} icon={Wifi} description="Currently reachable"/><StatCard title="Offline" value={offline.length} icon={WifiOff} description="Currently unreachable"/></div><DeviceList devices={devices} loading={devicesLoading} onSelect={setSelectedDevice} onRefresh={loadDevices} onCreate={()=>{setEditingDevice(null);setShowDeviceForm(true)}} onEdit={device=>{setSelectedDevice(null);setEditingDevice(device);setShowDeviceForm(true)}} onDelete={handleDeleteDevice}/></>}
    </main>
    {showCreate&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl"><div className="flex items-center justify-between border-b border-slate-800 px-6 py-4"><div><h3 className="font-semibold text-white">Create Network Incident</h3><p className="text-xs text-slate-500">This will immediately start the escalation workflow.</p></div><button onClick={()=>setShowCreate(false)} className="text-slate-500 hover:text-white"><X size={20}/></button></div><form onSubmit={handleCreateIncident} className="space-y-4 p-6"><input required placeholder="Device e.g. CORE-SW-01" value={form.device} onChange={e=>setForm({...form,device:e.target.value})} className="form-input"/><input required placeholder="Location" value={form.location} onChange={e=>setForm({...form,location:e.target.value})} className="form-input"/><select value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})} className="form-input"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select><textarea required rows="4" placeholder="Describe the incident..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="form-input resize-none"/><select value={form.technicianId} onChange={e=>setForm({...form,technicianId:e.target.value})} className="form-input"><option value="">Automatic Level 1 Technician</option>{technicians.filter(t=>t.active).map(t=><option key={t.technicianId} value={t.technicianId}>Level {t.level} - {t.name}</option>)}</select><div className="flex justify-end gap-3"><button type="button" onClick={()=>setShowCreate(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Cancel</button><button type="submit" className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500">Create & Escalate</button></div></form></div></div>}
    {showDeviceForm&&<DeviceFormModal device={editingDevice} onClose={()=>{setShowDeviceForm(false);setEditingDevice(null)}} onSaved={handleDeviceSaved}/>} 
    {selectedIncident&&<IncidentDetails incident={selectedIncident} onClose={()=>setSelectedIncident(null)} onResolve={handleResolve} resolving={resolving}/>} 
    {selectedDevice&&<DeviceDetails device={selectedDevice} onClose={()=>setSelectedDevice(null)} onEdit={()=>{setEditingDevice(selectedDevice);setSelectedDevice(null);setShowDeviceForm(true)}} onDelete={()=>handleDeleteDevice(selectedDevice)} onRefresh={async()=>{await loadDevices();const data=await getDevices();if(data.success){const updated=data.devices.find(d=>d.deviceId===selectedDevice.deviceId);if(updated)setSelectedDevice(updated);}}}/>} 
  </div>;
}

export default App;
