import { useEffect, useState } from "react";
import { KeyRound, Save, UserRound, X } from "lucide-react";
import { getPlatformTechnicians, getPlatformTechnician, updatePlatformTechnician, setPlatformTechnicianCredentials, getAuditLog } from "../services/platformApi";
import { PageHeader, LoadingRow } from "./ui";

function PlatformTechnicianDetail({ technicianId, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credBusy, setCredBusy] = useState(false);
  const [audit, setAudit] = useState([]);

  useEffect(() => {
    getPlatformTechnician(technicianId).then(r => {
      if (r.success) {
        setForm({ name: r.technician.name, phone: r.technician.phone || "", role: r.technician.role || "", active: r.technician.active !== false });
        setCredUsername(r.technician.username || "");
      }
      return r;
    }).then(setData).finally(() => setLoading(false));
    getAuditLog({ targetId: technicianId, limit: 10 }).then(r => { if (r.success) setAudit(r.entries); });
  }, [technicianId]);

  async function saveBio(e) {
    e.preventDefault(); setBioBusy(true);
    try {
      const r = await updatePlatformTechnician(technicianId, form);
      if (!r.success) throw new Error(r.message || "Failed to update technician.");
      onSaved();
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setBioBusy(false); }
  }

  async function saveCreds(e) {
    e.preventDefault(); setCredBusy(true);
    try {
      const r = await setPlatformTechnicianCredentials(technicianId, credUsername.trim(), credPassword);
      if (!r.success) throw new Error(r.message || "Failed to reset credentials.");
      setCredPassword("");
      alert("Credentials reset.");
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setCredBusy(false); }
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl">
      {loading ? <div className="p-10 text-center text-sm text-slate-600">Loading technician…</div> : !data ? <div className="p-10 text-center text-sm text-slate-600">Technician not found.</div> : <>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-2 text-purple-400"><UserRound size={17} /></div><div><h3 className="font-semibold text-white">{data.technician.name}</h3><p className="mt-1 text-xs text-slate-600">{data.technician.technicianId} · {data.realmName || "No realm"}</p></div></div>
          <button type="button" onClick={onClose}><X size={19} /></button>
        </div>

        <form onSubmit={saveBio} className="mt-5 space-y-3 border-b border-slate-800 pb-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Bio</p>
          <input required placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="form-input" />
          <input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="form-input" />
          <input placeholder="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="form-input" />
          <label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} /> Active for escalation</label>
          <div className="flex justify-end"><button disabled={bioBusy} className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{bioBusy ? "Saving..." : "Save"}</button></div>
        </form>

        <form onSubmit={saveCreds} className="mt-5 space-y-3 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-2 text-slate-300"><KeyRound size={14} className="text-purple-400" /><span className="text-[10px] font-bold uppercase tracking-wider">Reset credentials</span></div>
          <input placeholder="Username" value={credUsername} onChange={e => setCredUsername(e.target.value)} className="form-input" />
          <input required type="password" placeholder="New password (min 8 characters)" value={credPassword} onChange={e => setCredPassword(e.target.value)} className="form-input" />
          <div className="flex justify-end"><button disabled={credBusy} className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{credBusy ? "Saving..." : "Reset credentials"}</button></div>
        </form>

        <div className="mt-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Recent activity</p>
          {audit.length ? <div className="mt-2 space-y-2">{audit.map((entry, i) => <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"><span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">{entry.action.replaceAll("_", " ")}</span><span className="text-slate-500">{entry.actorName || "System"}</span><span className="text-slate-600">{new Date(entry.at).toLocaleString()}</span></div>)}</div> : <p className="mt-2 text-sm text-slate-600">No audit entries for this account yet.</p>}
        </div>
      </>}
    </div>
  </div>;
}

export default function PlatformTechnicians() {
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);

  async function reload() {
    setLoading(true);
    try { const r = await getPlatformTechnicians(); if (r.success) setTechnicians(r.technicians); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  return <div className="space-y-5">
    <PageHeader icon={UserRound} title="Technicians" subtitle="Every technician across every realm - click a row to audit or edit without Entering their realm." />
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.4fr_1fr_1fr_80px_100px]"><span>Technician</span><span>Realm</span><span>Phone</span><span>Level</span><span>Status</span></div>
      {loading ? <LoadingRow /> : technicians.length ? technicians.map(t => <button key={t.technicianId} onClick={() => setDetailId(t.technicianId)} className="grid w-full items-center gap-3 border-b border-slate-800/70 px-5 py-4 text-left transition hover:bg-slate-800/20 last:border-0 md:grid-cols-[1.4fr_1fr_1fr_80px_100px]">
        <div><p className="text-sm font-semibold text-white">{t.name}</p><p className="font-mono text-[10px] text-slate-600">{t.technicianId}</p></div>
        <div className="truncate text-sm text-slate-400">{t.realmName || "—"}</div>
        <div className="font-mono text-sm text-slate-300">{t.phone}</div>
        <div><span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-bold text-purple-400">L{t.level}</span></div>
        <div className={`text-[10px] font-semibold uppercase ${t.active ? "text-emerald-400" : "text-slate-600"}`}>{t.active ? "Active" : "Disabled"}</div>
      </button>) : <div className="p-12 text-center text-sm text-slate-600">No technicians found.</div>}
    </section>
    {detailId && <PlatformTechnicianDetail technicianId={detailId} onClose={() => setDetailId(null)} onSaved={() => { reload(); setDetailId(null); }} />}
  </div>;
}
