import { useState } from "react";
import { X, Building2, UserRound, Radio, Server, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { createRealm, enterRealm, exitRealm } from "../services/platformApi";
import { createTechnician, setTechnicianCredentials, createDevice } from "../services/api";

const INDUSTRIES = ["ISP", "Telecom", "Banking", "Government", "Enterprise", "Data Centre", "Education", "Healthcare", "Other"];
const STEPS = ["Organization", "Administrator", "Monitoring", "First device"];

// Creating a realm's first technician/device reuses the exact same
// realm-scoped routes (POST /technicians, POST /devices) every other realm
// uses - not separate platform-only endpoints. It works because step 1
// immediately Enters the new realm (the same Enter Realm mechanism a
// support session uses), so attachRealmScope resolves req.realmId to the
// realm just created; step 5 always exits, even on error, so a platform
// admin is never left silently "inside" a realm after closing the wizard.
export default function RealmSetupWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [realm, setRealm] = useState(null);

  const [org, setOrg] = useState({ name: "", slug: "", industry: "Enterprise", timezone: "UTC", description: "" });
  const [admin, setAdmin] = useState({ name: "", phone: "", username: "", password: "" });
  const [monitoring, setMonitoring] = useState({ snmpEnabled: true, community: "public", pollingInterval: 30 });
  const [device, setDevice] = useState({ hostname: "", ipAddress: "", deviceType: "router" });

  async function finishAndExit(success, errorMessage) {
    try { await exitRealm(); } catch { /* best-effort */ }
    if (success) onCreated();
    else setError(errorMessage);
  }

  async function submitOrg(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await createRealm({ name: org.name.trim(), slug: org.slug.trim().toLowerCase(), industry: org.industry, timezone: org.timezone, description: org.description });
      if (!r.success) throw new Error(r.message || "Failed to create realm.");
      setRealm(r.realm);
      const entered = await enterRealm(r.realm._id);
      if (!entered.success) throw new Error(entered.message || "Failed to enter the new realm.");
      setStep(1);
    } catch (e) { setError(e.response?.data?.message || e.message); }
    finally { setBusy(false); }
  }

  async function submitAdmin(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const technicianId = `TECH-${Date.now().toString(36).toUpperCase()}`;
      const created = await createTechnician({ technicianId, name: admin.name.trim(), phone: admin.phone.trim(), level: 3, role: "Realm Owner", active: true });
      if (!created.success) throw new Error(created.message || "Failed to create the organization administrator.");
      const cred = await setTechnicianCredentials(technicianId, admin.username.trim(), admin.password);
      if (!cred.success) throw new Error(cred.message || "Technician created, but login credentials could not be set.");
      setStep(2);
    } catch (e) { setError(e.response?.data?.message || e.message); }
    finally { setBusy(false); }
  }

  function submitMonitoring(e) { e.preventDefault(); setStep(3); }

  async function submitDevice(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (device.hostname.trim() && device.ipAddress.trim()) {
        const created = await createDevice({ hostname: device.hostname.trim(), ipAddress: device.ipAddress.trim(), deviceType: device.deviceType, monitoringEnabled: true, pollingInterval: monitoring.pollingInterval, monitoringMethods: monitoring.snmpEnabled ? ["icmp", "snmp"] : ["icmp"], snmp: { enabled: monitoring.snmpEnabled, version: "2c", community: monitoring.community } });
        if (!created.success) throw new Error(created.message || "Failed to add the first device.");
      }
      await finishAndExit(true);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
      setBusy(false);
    }
  }

  async function skipDevice() {
    setBusy(true);
    await finishAndExit(true);
  }

  async function cancelWizard() {
    if (realm) await finishAndExit(false);
    onClose();
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <div><h3 className="font-semibold text-white">Welcome to NetEscalate</h3><p className="mt-1 text-xs text-slate-600">Let's configure a new organization's monitoring environment.</p></div>
        <button type="button" onClick={cancelWizard}><X size={19} /></button>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {STEPS.map((label, i) => <div key={label} className="flex flex-1 items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i < step ? "bg-emerald-500/15 text-emerald-400" : i === step ? "bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30" : "bg-slate-800 text-slate-600"}`}>{i < step ? <Check size={13} /> : i + 1}</div>
          <span className={`hidden text-xs sm:block ${i === step ? "text-white" : "text-slate-600"}`}>{label}</span>
          {i < STEPS.length - 1 && <div className="h-px flex-1 bg-slate-800" />}
        </div>)}
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">{error}</div>}

      {step === 0 && <form onSubmit={submitOrg} className="mt-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-300"><Building2 size={16} className="text-purple-400" /><span className="text-xs font-semibold uppercase tracking-wider">Organization</span></div>
        <input required placeholder="Company / organization name" value={org.name} onChange={e => setOrg(f => ({ ...f, name: e.target.value }))} className="form-input" />
        <input required placeholder="Slug (e.g. acme-corp)" value={org.slug} onChange={e => setOrg(f => ({ ...f, slug: e.target.value }))} className="form-input" />
        <div className="grid grid-cols-2 gap-3">
          <select value={org.industry} onChange={e => setOrg(f => ({ ...f, industry: e.target.value }))} className="form-input">{INDUSTRIES.map(i => <option key={i}>{i}</option>)}</select>
          <input placeholder="Timezone (e.g. Africa/Lusaka)" value={org.timezone} onChange={e => setOrg(f => ({ ...f, timezone: e.target.value }))} className="form-input" />
        </div>
        <textarea rows="2" placeholder="Description (optional)" value={org.description} onChange={e => setOrg(f => ({ ...f, description: e.target.value }))} className="form-input resize-none" />
        <div className="flex justify-end"><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Next"}<ArrowRight size={15} /></button></div>
      </form>}

      {step === 1 && <form onSubmit={submitAdmin} className="mt-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-300"><UserRound size={16} className="text-purple-400" /><span className="text-xs font-semibold uppercase tracking-wider">Organization administrator</span></div>
        <p className="text-xs text-slate-600">This person becomes the realm owner - full access to {realm?.name}.</p>
        <input required placeholder="Full name" value={admin.name} onChange={e => setAdmin(f => ({ ...f, name: e.target.value }))} className="form-input" />
        <input required placeholder="Phone (e.g. +260977760291)" value={admin.phone} onChange={e => setAdmin(f => ({ ...f, phone: e.target.value }))} className="form-input" />
        <div className="grid grid-cols-2 gap-3">
          <input required placeholder="Username" value={admin.username} onChange={e => setAdmin(f => ({ ...f, username: e.target.value }))} className="form-input" />
          <input required type="password" placeholder="Password (min 8 characters)" value={admin.password} onChange={e => setAdmin(f => ({ ...f, password: e.target.value }))} className="form-input" />
        </div>
        <div className="flex justify-between"><button type="button" onClick={() => setStep(0)} className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm"><ArrowLeft size={15} />Back</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Next"}<ArrowRight size={15} /></button></div>
      </form>}

      {step === 2 && <form onSubmit={submitMonitoring} className="mt-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-300"><Radio size={16} className="text-purple-400" /><span className="text-xs font-semibold uppercase tracking-wider">Monitoring configuration</span></div>
        <p className="text-xs text-slate-600">Defaults for devices added to {realm?.name}. Every existing monitoring capability (SNMP, ICMP, interface health) still applies per-device afterward.</p>
        <label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={monitoring.snmpEnabled} onChange={e => setMonitoring(f => ({ ...f, snmpEnabled: e.target.checked }))} /> Enable SNMP by default</label>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Default SNMP community" value={monitoring.community} onChange={e => setMonitoring(f => ({ ...f, community: e.target.value }))} className="form-input" disabled={!monitoring.snmpEnabled} />
          <select value={monitoring.pollingInterval} onChange={e => setMonitoring(f => ({ ...f, pollingInterval: Number(e.target.value) }))} className="form-input"><option value="10">10 sec polling</option><option value="30">30 sec polling</option><option value="60">60 sec polling</option></select>
        </div>
        <div className="flex justify-between"><button type="button" onClick={() => setStep(1)} className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm"><ArrowLeft size={15} />Back</button><button className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white">Next<ArrowRight size={15} /></button></div>
      </form>}

      {step === 3 && <form onSubmit={submitDevice} className="mt-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-300"><Server size={16} className="text-purple-400" /><span className="text-xs font-semibold uppercase tracking-wider">Add the first device</span></div>
        <p className="text-xs text-slate-600">Optional - you can always add devices later from the Devices page.</p>
        <input placeholder="Hostname" value={device.hostname} onChange={e => setDevice(f => ({ ...f, hostname: e.target.value }))} className="form-input" />
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="IP address" value={device.ipAddress} onChange={e => setDevice(f => ({ ...f, ipAddress: e.target.value }))} className="form-input" />
          <select value={device.deviceType} onChange={e => setDevice(f => ({ ...f, deviceType: e.target.value }))} className="form-input"><option value="router">Router</option><option value="switch">Switch</option><option value="firewall">Firewall</option><option value="server">Server</option><option value="other">Other</option></select>
        </div>
        <div className="flex justify-between"><button type="button" onClick={skipDevice} disabled={busy} className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm disabled:opacity-50">Skip for now</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Finishing…" : "Finish setup"}<Check size={15} /></button></div>
      </form>}
    </div>
  </div>;
}
