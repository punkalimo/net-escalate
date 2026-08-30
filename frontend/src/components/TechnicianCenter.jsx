import { useEffect, useState } from "react";
import { Edit3, KeyRound, Phone, Plus, RefreshCw, Save, Trash2, UserRound, X, ShieldCheck, ShieldAlert, Zap, BarChart3, Users } from "lucide-react";
import { createTechnician, deleteTechnician, getTechnicians, getTechnicianCapability, setTechnicianCredentials, updateTechnicianRole, getTechnicianPerformance, testTechnicianCall, updateTechnician } from "../services/api";
import { isRealmManager, canGrantRealmOwner } from "../utils/permissions";

const empty = { technicianId: "", name: "", phone: "", level: 1, role: "Network Technician", active: true, realmRole: "technician" };

const REALM_ROLE_LABELS = { realm_owner: "Realm owner", realm_admin: "Realm admin", noc_manager: "NOC manager", senior_engineer: "Senior engineer", technician: "Technician", viewer: "Viewer" };
const REALM_ROLE_PILL = { realm_owner: "border-purple-500/30 bg-purple-500/10 text-purple-400", realm_admin: "border-blue-500/30 bg-blue-500/10 text-blue-400", noc_manager: "border-blue-500/30 bg-blue-500/10 text-blue-400", senior_engineer: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", technician: "border-slate-700 bg-slate-800/60 text-slate-400", viewer: "border-slate-700 bg-slate-800/60 text-slate-500" };

function TechnicianModal({ technician, admin, currentUser, onClose, onSaved }) {
  const [form, setForm] = useState(technician ? { ...technician, realmRole: technician.realmRole || "technician" } : empty);
  const [busy, setBusy] = useState(false);
  const [credUsername, setCredUsername] = useState(technician?.username || "");
  const [credPassword, setCredPassword] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const roleOptions = Object.keys(REALM_ROLE_LABELS).filter(r => r !== "realm_owner" || canGrantRealmOwner(currentUser) || form.realmRole === "realm_owner");
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { ...form, technicianId: form.technicianId.trim(), name: form.name.trim(), phone: form.phone.trim(), level: Number(form.level) };
      const r = technician ? await updateTechnician(technician.technicianId, payload) : await createTechnician(payload);
      if (!r.success) throw new Error(r.message || "Failed to save technician.");

      if (technician && admin && form.realmRole && form.realmRole !== (technician.realmRole || "technician")) {
        const rr = await updateTechnicianRole(r.technician.technicianId, form.realmRole);
        if (!rr.success) throw new Error(rr.message || "Technician saved, but its realm role could not be changed.");
      }

      if (admin && credPassword.trim()) {
        const cr = await setTechnicianCredentials(r.technician.technicianId, credUsername.trim(), credPassword);
        if (!cr.success) throw new Error(cr.message || "Technician saved, but login credentials could not be set.");
      }
      onSaved(r.technician); onClose();
    } catch (e) { alert(e.response?.data?.message || e.message); } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
    <form onSubmit={submit} className="w-full max-w-xl rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl">
      <div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">{technician ? "Edit technician" : "Add technician"}</h3><p className="mt-1 text-xs text-slate-600">Configure the person and phone number used for escalation.</p></div><button type="button" onClick={onClose}><X size={19}/></button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <input required disabled={!!technician} placeholder="Technician ID e.g. TECH-001" value={form.technicianId} onChange={e=>set("technicianId",e.target.value)} className="form-input disabled:opacity-50"/>
        <input required placeholder="Full name" value={form.name} onChange={e=>set("name",e.target.value)} className="form-input"/>
        <input required placeholder="+260977760291" value={form.phone} onChange={e=>set("phone",e.target.value)} className="form-input"/>
        <select value={form.level} onChange={e=>set("level",e.target.value)} className="form-input"><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option></select>
        <input placeholder="Role" value={form.role} onChange={e=>set("role",e.target.value)} className="form-input sm:col-span-2"/>
        {admin && <select value={form.realmRole} onChange={e=>set("realmRole",e.target.value)} className="form-input sm:col-span-2"><option value="" disabled>Realm role (authorization)</option>{roleOptions.map(r=><option key={r} value={r}>{REALM_ROLE_LABELS[r]}</option>)}</select>}
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={form.active !== false} onChange={e=>set("active",e.target.checked)}/> Active for escalation</label>

      {admin && <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex items-center gap-2 text-slate-300"><KeyRound size={14} className="text-blue-400"/><span className="text-xs font-semibold uppercase tracking-wider">Dashboard login</span>{technician?.hasLogin && <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] font-bold text-emerald-400">Enabled</span>}</div>
        <p className="mt-1.5 text-[11px] leading-4 text-slate-600">{technician?.hasLogin ? "Leave password blank to keep the current one. Setting a new password resets it immediately - use this if a technician forgets their credentials." : "Optional - grant this technician access to sign in to the dashboard."}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input placeholder="Username" value={credUsername} onChange={e=>setCredUsername(e.target.value)} className="form-input"/>
          <input type="password" placeholder={technician?.hasLogin ? "New password (leave blank to keep)" : "Password (min 8 characters)"} value={credPassword} onChange={e=>setCredPassword(e.target.value)} className="form-input"/>
        </div>
      </div>}

      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15}/>{busy ? "Saving..." : "Save technician"}</button></div>
    </form>
  </div>;
}

const PERF_TONE = { good: "text-emerald-400", warn: "text-amber-400", bad: "text-red-400", neutral: "text-slate-400" };
function ackRateTone(rate) { if (rate == null) return "neutral"; if (rate >= 80) return "good"; if (rate >= 50) return "warn"; return "bad"; }

function TechnicianPerformancePanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getTechnicianPerformance().then(r => { if (r.success) setRows(r.performance); }).finally(() => setLoading(false)); }, []);
  const sorted = [...rows].sort((a, b) => b.activeIncidents - a.activeIncidents || (b.acknowledgeRate ?? -1) - (a.acknowledgeRate ?? -1));
  return <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-xl shadow-black/10">
    <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.2fr_90px_90px_90px_100px_110px_110px]"><span>Technician</span><span>Active</span><span>Resolved</span><span>Calls</span><span>Ack rate</span><span>Mean TTA</span><span>Escalated away</span></div>
    {loading ? <div className="p-12 text-center text-sm text-slate-600">Loading performance…</div> : sorted.length ? sorted.map(p => <div key={p.technicianId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.2fr_90px_90px_90px_100px_110px_110px]">
      <div><p className="text-sm font-semibold text-white">{p.name}</p><p className="text-xs text-slate-600">{REALM_ROLE_LABELS[p.realmRole] || p.realmRole} · L{p.level}</p></div>
      <div className={`text-sm font-semibold ${p.activeIncidents ? "text-amber-400" : "text-slate-500"}`}>{p.activeIncidents}</div>
      <div className="text-sm text-slate-300">{p.resolvedIncidents}</div>
      <div className="text-sm text-slate-300">{p.callsReceived}</div>
      <div className={`text-sm font-semibold ${PERF_TONE[ackRateTone(p.acknowledgeRate)]}`}>{p.acknowledgeRate != null ? `${p.acknowledgeRate}%` : "—"}</div>
      <div className="text-sm text-slate-300">{p.meanTimeToAcknowledgeMinutes != null ? `${p.meanTimeToAcknowledgeMinutes}m` : "—"}</div>
      <div className={`text-sm ${p.escalatedAway ? "text-red-400" : "text-slate-500"}`}>{p.escalatedAway}</div>
    </div>) : <div className="p-12 text-center text-sm text-slate-600">No technicians to measure yet.</div>}
  </section>;
}

function CapabilityBadge({ capability }) {
  if (!capability) return <span className="text-[10px] text-slate-600">Checking…</span>;
  if (capability.state === "UNSUPPORTED") return <span title={capability.message} className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/5 px-2 py-1 text-[10px] font-semibold text-red-400"><ShieldAlert size={11}/> CALL-E unavailable</span>;
  if (capability.state === "SUPPORTED") return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[10px] font-semibold text-emerald-400"><ShieldCheck size={11}/> CALL-E ready</span>;
  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] font-semibold text-amber-400"><Zap size={11}/> Provider check</span>;
}

export default function TechnicianCenter({ user }) {
  const admin = isRealmManager(user);
  const [technicians, setTechnicians] = useState([]);
  const [capabilities, setCapabilities] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [calling, setCalling] = useState("");
  const [callResult, setCallResult] = useState(null);
  const [tab, setTab] = useState("team");

  async function reload() {
    try {
      setLoading(true);
      const r = await getTechnicians();
      const list = r.success ? (r.technicians || []) : [];
      setTechnicians(list);
      const entries = await Promise.all(list.map(async t => {
        try { const result = await getTechnicianCapability(t.technicianId); return [t.technicianId, result.capability]; }
        catch { return [t.technicianId, { state: "UNKNOWN", message: "Capability check unavailable." }]; }
      }));
      setCapabilities(Object.fromEntries(entries));
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  async function remove(t) {
    if (!confirm(`Delete ${t.name} (${t.phone})?`)) return;
    try { const r = await deleteTechnician(t.technicianId); if (!r.success) throw new Error(r.message); await reload(); }
    catch (e) { alert(e.response?.data?.message || e.message); }
  }

  async function testCall(t) {
    const capability = capabilities[t.technicianId];
    if (capability?.state === "UNSUPPORTED") {
      setCallResult({ ok: false, technician: t, message: capability.message, capability });
      return;
    }
    if (!confirm(`CALL-E will place a REAL call to ${t.name} at ${t.phone}. Continue?`)) return;
    setCalling(t.technicianId); setCallResult(null);
    try {
      const r = await testTechnicianCall(t.technicianId);
      setCallResult({ ok: r.success, technician: t, call: r.call, message: r.message, capability: r.capability });
    } catch (e) {
      const data = e.response?.data;
      setCallResult({ ok: false, technician: t, message: data?.message || e.message, capability: data?.capability, code: data?.code });
    } finally { setCalling(""); }
  }

  const unsupported = technicians.filter(t => capabilities[t.technicianId]?.state === "UNSUPPORTED").length;

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><div className="flex items-center gap-2"><div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2 text-blue-400"><Phone size={17}/></div><h1 className="text-2xl font-bold text-white">Escalation team</h1></div><p className="mt-2 max-w-2xl text-sm text-slate-500">Manage technicians, routing levels and outbound-call readiness. NetEscalate never changes a destination region to bypass a provider restriction.</p></div>
      <div className="flex gap-2"><button onClick={reload} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-slate-400 hover:text-white"><RefreshCw size={16}/></button>{admin && tab==="team" && <button onClick={()=>setModal("new")} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"><Plus size={16}/> Add technician</button>}</div>
    </div>

    {admin && <div className="flex gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
      <button onClick={()=>setTab("team")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition ${tab==="team" ? "bg-blue-500/10 text-blue-400" : "text-slate-500 hover:text-slate-300"}`}><Users size={14}/> Team</button>
      <button onClick={()=>setTab("performance")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition ${tab==="performance" ? "bg-blue-500/10 text-blue-400" : "text-slate-500 hover:text-slate-300"}`}><BarChart3 size={14}/> Performance</button>
    </div>}

    {tab==="performance" && admin && <TechnicianPerformancePanel/>}

    {(tab==="team" || !admin) && <>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Technicians</p><p className="mt-2 text-2xl font-bold text-white">{technicians.length}</p><p className="mt-1 text-xs text-slate-600">Configured escalation contacts</p></div>
      <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Active</p><p className="mt-2 text-2xl font-bold text-emerald-400">{technicians.filter(t=>t.active).length}</p><p className="mt-1 text-xs text-slate-600">Eligible for escalation</p></div>
      <div className="rounded-2xl border border-red-500/10 bg-red-500/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Unavailable routes</p><p className="mt-2 text-2xl font-bold text-red-400">{unsupported}</p><p className="mt-1 text-xs text-slate-600">Provider capability restrictions</p></div>
    </div>

    {unsupported > 0 && <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4"><ShieldAlert size={19} className="mt-0.5 shrink-0 text-amber-400"/><div><p className="text-sm font-semibold text-amber-300">CALL-E routing restriction detected</p><p className="mt-1 text-xs leading-5 text-slate-500">One or more technicians have destinations that CALL-E currently rejects. NetEscalate will not spoof the region or repeatedly escalate the same permanent provider failure.</p></div></div>}

    {callResult && <div className={`rounded-2xl border p-4 ${callResult.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}><div className="flex items-center justify-between"><div><p className={`text-sm font-semibold ${callResult.ok ? "text-emerald-400" : "text-red-400"}`}>{callResult.ok ? "CALL-E test completed" : "CALL-E test not available"}</p><p className="mt-1 text-xs text-slate-500">{callResult.technician?.name} · {callResult.technician?.phone}</p></div><button onClick={()=>setCallResult(null)}><X size={16}/></button></div><p className="mt-2 text-xs leading-5 text-slate-400">{callResult.message || callResult.call?.summary || callResult.call?.structuredResult?.technician_response || "Call completed."}</p>{callResult.code && <p className="mt-2 font-mono text-[10px] text-slate-600">Provider code: {callResult.code}</p>}</div>}

    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-xl shadow-black/10">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.2fr_1fr_70px_1fr_1.3fr_190px]"><span>Technician</span><span>Phone</span><span>Level</span><span>Role</span><span>Routing status</span><span>Actions</span></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-600">Loading escalation team…</div> : technicians.length ? technicians.map(t => <div key={t.technicianId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 transition hover:bg-slate-800/20 last:border-0 md:grid-cols-[1.2fr_1fr_70px_1fr_1.3fr_190px]">
        <div className="flex items-center gap-3"><div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5"><UserRound size={17} className="text-blue-400"/></div><div><p className="text-sm font-semibold text-white">{t.name}</p><p className="font-mono text-[10px] text-slate-600">{t.technicianId}</p></div></div>
        <div className="font-mono text-sm text-slate-300">{t.phone}</div>
        <div><span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-400">L{t.level}</span></div>
        <div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${REALM_ROLE_PILL[t.realmRole] || REALM_ROLE_PILL.technician}`}>{REALM_ROLE_LABELS[t.realmRole] || "Technician"}</span></div>
        <div><div className="flex flex-wrap items-center gap-2"><CapabilityBadge capability={capabilities[t.technicianId]}/><span className={`text-[10px] font-semibold uppercase ${t.active ? "text-emerald-400" : "text-slate-600"}`}>{t.active ? "Active" : "Disabled"}</span>{admin && t.hasLogin && <span title={`Username: ${t.username}`} className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/5 px-2 py-0.5 text-[9px] font-bold text-blue-400"><KeyRound size={9}/> Login enabled</span>}</div><p className="mt-1 text-xs text-slate-500">{t.role || "Network Technician"}</p></div>
        <div className="flex flex-wrap gap-2"><button disabled={!t.active || !!calling || capabilities[t.technicianId]?.state === "UNSUPPORTED"} onClick={()=>testCall(t)} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"><Phone size={13}/>{calling===t.technicianId ? "Calling…" : "Test call"}</button>{admin && <><button onClick={()=>setModal(t)} title="Edit" className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><Edit3 size={14}/></button><button onClick={()=>remove(t)} title="Delete" className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/5"><Trash2 size={14}/></button></>}</div>
      </div>) : <div className="p-12 text-center"><UserRound className="mx-auto text-slate-700" size={36}/><p className="mt-3 text-sm font-medium text-white">No technicians configured</p><p className="mt-1 text-xs text-slate-600">Add your own number first, then use Test call.</p></div>}
    </section>
    </>}
    {modal && <TechnicianModal technician={modal === "new" ? null : modal} admin={admin} currentUser={user} onClose={()=>setModal(null)} onSaved={()=>reload()}/>}
  </div>;
}
