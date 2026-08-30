import { useEffect, useState } from "react";
import { MapPin, Plus, RefreshCw, Pencil, Trash2, X, Save, Server, AlertTriangle, WifiOff } from "lucide-react";
import { getSites, createSite, updateSite, deleteSite, getSite } from "../services/api";

const empty = { name: "", address: "", description: "", timezone: "UTC" };

function SiteModal({ site, onClose, onSaved }) {
  const [form, setForm] = useState(site || empty);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { name: form.name.trim(), address: form.address.trim(), description: form.description.trim(), timezone: form.timezone.trim() || "UTC" };
      const r = site ? await updateSite(site._id, payload) : await createSite(payload);
      if (!r.success) throw new Error(r.message || "Failed to save site.");
      onSaved(r.site); onClose();
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl">
      <div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">{site ? "Edit site" : "Add site"}</h3><p className="mt-1 text-xs text-slate-600">A physical/network location - devices are assigned to it separately.</p></div><button type="button" onClick={onClose}><X size={19} /></button></div>
      <div className="mt-5 space-y-4">
        <input required placeholder="Site name e.g. Lusaka HQ" value={form.name} onChange={e => set("name", e.target.value)} className="form-input" />
        <input placeholder="Address" value={form.address} onChange={e => set("address", e.target.value)} className="form-input" />
        <input placeholder="Timezone e.g. Africa/Lusaka" value={form.timezone} onChange={e => set("timezone", e.target.value)} className="form-input" />
        <textarea rows="3" placeholder="Description (optional)" value={form.description} onChange={e => set("description", e.target.value)} className="form-input resize-none" />
      </div>
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{busy ? "Saving..." : "Save site"}</button></div>
    </form>
  </div>;
}

const DEVICE_STATUS_TONE = { UP: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400", DOWN: "border-red-500/30 bg-red-500/10 text-red-400", DEGRADED: "border-orange-500/30 bg-orange-500/10 text-orange-400", UNKNOWN: "border-slate-700 bg-slate-800/60 text-slate-500" };

function SiteDetails({ siteId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSite(siteId).then(r => { if (r.success) setData(r); }).finally(() => setLoading(false));
  }, [siteId]);

  return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl">
      {loading ? <div className="p-10 text-center text-sm text-slate-600"><RefreshCw size={16} className="mx-auto mb-2 animate-spin" />Loading site performance…</div> : data ? <>
        <div className="flex items-center justify-between"><div><h3 className="font-semibold text-white">{data.site.name}</h3><p className="mt-1 text-xs text-slate-600">{data.site.address || "No address set"}</p></div><button onClick={onClose}><X size={19} /></button></div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Devices</p><p className="mt-1 text-lg font-bold text-white">{data.deviceCount}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Down</p><p className="mt-1 text-lg font-bold text-red-400">{data.statusCounts.DOWN || 0}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">Active incidents</p><p className="mt-1 text-lg font-bold text-amber-400">{data.overview.activeIncidents}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="text-[10px] uppercase tracking-wider text-slate-600">MTTA / MTTR</p><p className="mt-1 text-sm font-bold text-white">{data.overview.meanTimeToAcknowledgeMinutes ?? "—"}m / {data.overview.meanTimeToResolveMinutes ?? "—"}m</p></div>
        </div>

        <div className="mt-5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Devices at this site</p>
          {data.devices.length ? <div className="mt-2 space-y-2">{data.devices.map(d => <div key={d.deviceId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-300">{d.hostname}</p><p className="font-mono text-[10px] text-slate-600">{d.ipAddress}</p></div>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${DEVICE_STATUS_TONE[d.status] || DEVICE_STATUS_TONE.UNKNOWN}`}>{d.status || "UNKNOWN"}</span>
          </div>)}</div> : <p className="mt-2 text-sm text-slate-600">No devices assigned to this site yet.</p>}
        </div>
      </> : <p className="p-10 text-center text-sm text-slate-600">Site not found.</p>}
    </div>
  </div>;
}

export default function SitesCenter() {
  const [sites, setSites] = useState([]);
  const [unassignedDeviceCount, setUnassignedDeviceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [detailsId, setDetailsId] = useState(null);

  async function reload() {
    setLoading(true);
    try {
      const r = await getSites();
      if (r.success) { setSites(r.sites); setUnassignedDeviceCount(r.unassignedDeviceCount); }
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function remove(site) {
    if (!confirm(`Delete ${site.name}? Its devices will become unassigned, not deleted.`)) return;
    try { const r = await deleteSite(site._id); if (!r.success) throw new Error(r.message); await reload(); }
    catch (e) { alert(e.response?.data?.message || e.message); }
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="flex items-center gap-2"><div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2 text-blue-400"><MapPin size={17} /></div><h1 className="text-2xl font-bold text-white">Sites</h1></div><p className="mt-2 max-w-2xl text-sm text-slate-500">Physical/network locations within your organization. Assign devices to a site for a holistic view of that location's performance.</p></div>
      <div className="flex gap-2"><button onClick={reload} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-slate-400 hover:text-white"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button><button onClick={() => setModal("new")} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"><Plus size={16} /> Add site</button></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Sites</p><p className="mt-2 text-2xl font-bold text-white">{sites.length}</p></div>
      <div className="rounded-2xl border border-red-500/10 bg-red-500/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Sites with devices down</p><p className="mt-2 text-2xl font-bold text-red-400">{sites.filter(s => s.devicesDown > 0).length}</p></div>
      <div className="rounded-2xl border border-amber-500/10 bg-amber-500/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Unassigned devices</p><p className="mt-2 text-2xl font-bold text-amber-400">{unassignedDeviceCount}</p></div>
    </div>

    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[1.4fr_100px_120px_140px_120px]"><span>Site</span><span>Devices</span><span>Down</span><span>Active incidents</span><span>Actions</span></div>
      {loading ? <div className="p-12 text-center text-sm text-slate-600">Loading sites…</div> : sites.length ? sites.map(site => <div key={site._id} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-4 last:border-0 md:grid-cols-[1.4fr_100px_120px_140px_120px]">
        <button onClick={() => setDetailsId(site._id)} className="min-w-0 text-left"><p className="truncate text-sm font-semibold text-white hover:text-blue-400">{site.name}</p><p className="truncate text-xs text-slate-600">{site.address || "No address set"}</p></button>
        <div className="flex items-center gap-1.5 text-sm text-slate-300"><Server size={13} className="text-slate-600" />{site.deviceCount}</div>
        <div className="flex items-center gap-1.5 text-sm text-slate-300">{site.devicesDown > 0 && <WifiOff size={13} className="text-red-400" />}<span className={site.devicesDown > 0 ? "text-red-400" : ""}>{site.devicesDown}</span></div>
        <div className="flex items-center gap-1.5 text-sm text-slate-300">{site.activeIncidentCount > 0 && <AlertTriangle size={13} className="text-amber-400" />}<span className={site.activeIncidentCount > 0 ? "text-amber-400" : ""}>{site.activeIncidentCount}</span></div>
        <div className="flex gap-2"><button onClick={() => setModal(site)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><Pencil size={14} /></button><button onClick={() => remove(site)} className="rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/5"><Trash2 size={14} /></button></div>
      </div>) : <div className="p-12 text-center"><MapPin className="mx-auto text-slate-700" size={36} /><p className="mt-3 text-sm font-medium text-white">No sites configured</p><p className="mt-1 text-xs text-slate-600">Add a site, then assign devices to it from the Devices page.</p></div>}
    </section>

    {modal && <SiteModal site={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={reload} />}
    {detailsId && <SiteDetails siteId={detailsId} onClose={() => setDetailsId(null)} />}
  </div>;
}
