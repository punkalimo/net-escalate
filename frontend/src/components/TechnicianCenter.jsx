import { useEffect, useState } from "react";
import { Edit3, Phone, Plus, RefreshCw, Save, Trash2, UserRound, X, Zap } from "lucide-react";
import { createTechnician, deleteTechnician, getTechnicians, testTechnicianCall, updateTechnician } from "../services/api";

const empty = { technicianId: "", name: "", phone: "", level: 1, role: "Network Technician", active: true };

function TechnicianModal({ technician, onClose, onSaved }) {
  const [form, setForm] = useState(technician || empty);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { ...form, technicianId: form.technicianId.trim(), name: form.name.trim(), phone: form.phone.trim(), level: Number(form.level) };
      const r = technician ? await updateTechnician(technician.technicianId, payload) : await createTechnician(payload);
      if (!r.success) throw new Error(r.message || "Failed to save technician.");
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
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={form.active !== false} onChange={e=>set("active",e.target.checked)}/> Active for escalation</label>
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15}/>{busy ? "Saving..." : "Save technician"}</button></div>
    </form>
  </div>;
}

export default function TechnicianCenter() {
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [calling, setCalling] = useState("");
  const [callResult, setCallResult] = useState(null);
  async function reload() { try { setLoading(true); const r = await getTechnicians(); if (r.success) setTechnicians(r.technicians || []); } catch (e) { alert(e.response?.data?.message || e.message); } finally { setLoading(false); } }
  useEffect(() => { reload(); }, []);
  async function remove(t) { if (!confirm(`Delete ${t.name} (${t.phone})?`)) return; try { const r = await deleteTechnician(t.technicianId); if (!r.success) throw new Error(r.message); await reload(); } catch (e) { alert(e.response?.data?.message || e.message); } }
  async function testCall(t) {
    if (!confirm(`CALL-E will place a REAL call to ${t.name} at ${t.phone}. Continue?`)) return;
    setCalling(t.technicianId); setCallResult(null);
    try { const r = await testTechnicianCall(t.technicianId); setCallResult({ ok: r.success, technician: t, call: r.call, message: r.message }); } catch (e) { setCallResult({ ok: false, technician: t, message: e.response?.data?.message || e.message }); } finally { setCalling(""); }
  }
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-2xl font-bold text-white">Escalation team</h1><p className="mt-1 text-sm text-slate-600">Manage technicians, phone numbers and escalation levels. Use the test-call control to verify CALL-E Zambia routing.</p></div><div className="flex gap-2"><button onClick={reload} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-slate-400"><RefreshCw size={16}/></button><button onClick={()=>setModal("new")} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16}/> Add technician</button></div></div>
    {callResult && <div className={`rounded-xl border p-4 ${callResult.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}><div className="flex items-center justify-between"><div><p className={`text-sm font-semibold ${callResult.ok ? "text-emerald-400" : "text-red-400"}`}>{callResult.ok ? "CALL-E test completed" : "CALL-E test failed"}</p><p className="mt-1 text-xs text-slate-500">{callResult.technician?.name} · {callResult.technician?.phone}</p></div><button onClick={()=>setCallResult(null)}><X size={16}/></button></div><p className="mt-2 text-xs text-slate-400">{callResult.message || callResult.call?.summary || callResult.call?.structuredResult?.technician_response || "Call completed."}</p></div>}
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/40 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.4fr_1fr_100px_1.4fr_180px]"><span>Technician</span><span>Phone</span><span>Level</span><span>Status / role</span><span>Actions</span></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-600">Loading technicians...</div> : technicians.length ? technicians.map(t => <div key={t.technicianId} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.4fr_1fr_100px_1.4fr_180px]"><div className="flex items-center gap-3"><div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5"><UserRound size={17} className="text-blue-400"/></div><div><p className="text-sm font-semibold text-white">{t.name}</p><p className="font-mono text-[10px] text-slate-600">{t.technicianId}</p></div></div><div className="font-mono text-sm text-slate-300">{t.phone}</div><div><span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-400">L{t.level}</span></div><div><p className="text-xs text-slate-400">{t.role || "Network Technician"}</p><p className={`mt-1 text-[10px] font-semibold uppercase ${t.active ? "text-emerald-400" : "text-slate-600"}`}>{t.active ? "Active" : "Disabled"}</p></div><div className="flex flex-wrap gap-2"><button disabled={!t.active || !!calling} onClick={()=>testCall(t)} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-[10px] font-semibold text-emerald-400 disabled:opacity-40"><Phone size={13}/>{calling===t.technicianId ? "Calling..." : "Test call"}</button><button onClick={()=>setModal(t)} className="rounded-lg border border-slate-700 p-2 text-slate-400"><Edit3 size={14}/></button><button onClick={()=>remove(t)} className="rounded-lg border border-red-500/20 p-2 text-red-400"><Trash2 size={14}/></button></div></div>) : <div className="p-12 text-center"><UserRound className="mx-auto text-slate-700" size={36}/><p className="mt-3 text-sm font-medium text-white">No technicians configured</p><p className="mt-1 text-xs text-slate-600">Add your own number first, then use Test call.</p></div>}
    </section>
    {modal && <TechnicianModal technician={modal === "new" ? null : modal} onClose={()=>setModal(null)} onSaved={()=>reload()}/>} 
  </div>;
}
