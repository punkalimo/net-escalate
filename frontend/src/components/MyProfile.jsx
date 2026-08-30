import { useState } from "react";
import { KeyRound, Save, UserRound, X } from "lucide-react";
import { updateMyProfile, updateMyCredentials } from "../services/api";

export default function MyProfileModal({ user, onClose, onUpdated }) {
  const [bio, setBio] = useState({ name: user.name || "", phone: user.phone || "" });
  const [bioBusy, setBioBusy] = useState(false);
  const [creds, setCreds] = useState({ currentPassword: "", newUsername: user.username || "", newPassword: "" });
  const [credsBusy, setCredsBusy] = useState(false);
  const setBioField = (k, v) => setBio(f => ({ ...f, [k]: v }));
  const setCredsField = (k, v) => setCreds(f => ({ ...f, [k]: v }));

  async function saveBio(e) {
    e.preventDefault(); setBioBusy(true);
    try {
      const r = await updateMyProfile({ name: bio.name.trim(), phone: bio.phone.trim() });
      if (!r.success) throw new Error(r.message || "Failed to update profile.");
      onUpdated(r.user);
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setBioBusy(false); }
  }

  async function saveCreds(e) {
    e.preventDefault(); setCredsBusy(true);
    try {
      const payload = { currentPassword: creds.currentPassword };
      if (creds.newUsername.trim() && creds.newUsername.trim() !== user.username) payload.newUsername = creds.newUsername.trim();
      if (creds.newPassword.trim()) payload.newPassword = creds.newPassword;
      const r = await updateMyCredentials(payload);
      if (!r.success) throw new Error(r.message || "Failed to update credentials.");
      onUpdated(r.user);
      setCreds({ currentPassword: "", newUsername: r.user.username || "", newPassword: "" });
      alert("Credentials updated.");
    } catch (e) { alert(e.response?.data?.message || e.message); }
    finally { setCredsBusy(false); }
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-[#0b111b] p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-2 text-blue-400"><UserRound size={17} /></div><div><h3 className="font-semibold text-white">My profile</h3><p className="mt-1 text-xs text-slate-600">{user.realmName || user.role}</p></div></div>
        <button type="button" onClick={onClose}><X size={19} /></button>
      </div>

      <form onSubmit={saveBio} className="mt-5 space-y-3 border-b border-slate-800 pb-5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Bio</p>
        <input required placeholder="Full name" value={bio.name} onChange={e => setBioField("name", e.target.value)} className="form-input" />
        <input placeholder="Phone" value={bio.phone} onChange={e => setBioField("phone", e.target.value)} className="form-input" />
        <div className="flex justify-end"><button disabled={bioBusy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{bioBusy ? "Saving..." : "Save bio"}</button></div>
      </form>

      <form onSubmit={saveCreds} className="mt-5 space-y-3">
        <div className="flex items-center gap-2 text-slate-300"><KeyRound size={14} className="text-blue-400" /><span className="text-[10px] font-bold uppercase tracking-wider">Change credentials</span></div>
        <p className="text-[11px] leading-4 text-slate-600">Enter your current password to change your username or password.</p>
        <input required type="password" placeholder="Current password" value={creds.currentPassword} onChange={e => setCredsField("currentPassword", e.target.value)} className="form-input" />
        <input placeholder="Username" value={creds.newUsername} onChange={e => setCredsField("newUsername", e.target.value)} className="form-input" />
        <input type="password" placeholder="New password (leave blank to keep)" value={creds.newPassword} onChange={e => setCredsField("newPassword", e.target.value)} className="form-input" />
        <div className="flex justify-end"><button disabled={credsBusy} className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{credsBusy ? "Saving..." : "Update credentials"}</button></div>
      </form>
    </div>
  </div>;
}
