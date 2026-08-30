import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Plus, RefreshCw, Search, LogIn, Pause, Play, Eye } from "lucide-react";
import { getRealms, updateRealm, enterRealm } from "../services/platformApi";
import { PageHeader, Pill, LoadingRow, statusTone } from "./ui";
import RealmSetupWizard from "./RealmSetupWizard";

export default function RealmsPage() {
  const navigate = useNavigate();
  const [realms, setRealms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busyId, setBusyId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (status !== "ALL") params.status = status;
      const r = await getRealms(params);
      if (r.success) setRealms(r.realms);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  async function toggleStatus(realm) {
    setBusyId(realm._id);
    try {
      const nextStatus = realm.status === "active" ? "suspended" : "active";
      const r = await updateRealm(realm._id, { status: nextStatus });
      if (r.success) setRealms(list => list.map(item => item._id === realm._id ? { ...item, status: nextStatus } : item));
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setBusyId(""); }
  }

  async function doEnter(realm) {
    setBusyId(realm._id);
    try {
      const r = await enterRealm(realm._id);
      if (r.success) window.location.href = "/";
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setBusyId(""); }
  }

  return <div className="space-y-5">
    <PageHeader icon={Building2} title="Realms" subtitle="Every customer organization running on this NetEscalate installation." action={
      <button onClick={() => setWizardOpen(true)} className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500"><Plus size={16} /> Create realm</button>
    } />

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" /><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && load()} placeholder="Search realm name…" className="form-input w-full pl-9" /></div>
      <select value={status} onChange={e => setStatus(e.target.value)} className="form-input sm:w-48"><option value="ALL">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select>
      <button onClick={load} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-slate-400 hover:text-white"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
    </div>

    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.6fr_90px_90px_90px_110px_1fr]"><span>Realm</span><span>Devices</span><span>Techs</span><span>Incidents</span><span>Status</span><span>Actions</span></div>
      {loading ? <LoadingRow label="Loading realms…" /> : realms.length ? realms.map(realm => <div key={realm._id} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.6fr_90px_90px_90px_110px_1fr]">
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{realm.name}</p><p className="font-mono text-[10px] text-slate-600">{realm.slug} · {realm.industry}</p></div>
        <div className="text-sm text-slate-300">{realm.deviceCount}</div>
        <div className="text-sm text-slate-300">{realm.technicianCount}</div>
        <div className="text-sm text-slate-300">{realm.activeIncidentCount} active</div>
        <div><Pill className={statusTone[realm.status] || statusTone.disabled}>{realm.status}</Pill></div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => navigate(`/platform/realms/${realm._id}`)} title="View" className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><Eye size={14} /></button>
          <button onClick={() => doEnter(realm)} disabled={busyId === realm._id} title="Enter realm" className="flex items-center gap-1 rounded-lg border border-blue-500/20 bg-blue-500/5 px-2.5 py-2 text-[11px] font-semibold text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"><LogIn size={13} />Enter</button>
          <button onClick={() => toggleStatus(realm)} disabled={busyId === realm._id} title={realm.status === "active" ? "Suspend" : "Activate"} className={`rounded-lg border p-2 ${realm.status === "active" ? "border-amber-500/20 text-amber-400 hover:bg-amber-500/5" : "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/5"}`}>{realm.status === "active" ? <Pause size={14} /> : <Play size={14} />}</button>
        </div>
      </div>) : <div className="p-12 text-center"><Building2 className="mx-auto text-slate-700" size={36} /><p className="mt-3 text-sm font-medium text-white">No realms found</p></div>}
    </section>

    {wizardOpen && <RealmSetupWizard onClose={() => setWizardOpen(false)} onCreated={() => { setWizardOpen(false); load(); }} />}
  </div>;
}
