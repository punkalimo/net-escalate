import { useState } from "react";
import { Network, ShieldAlert } from "lucide-react";
import { login } from "../services/api";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(username.trim(), password);
      if (!result.success) throw new Error(result.message || "Login failed.");
      onLogin(result.user);
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Unable to log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050810] p-4 text-slate-200">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#080d16] p-7 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-2.5"><Network size={20} /></div>
          <div>
            <p className="font-bold text-white">NetEscalate</p>
            <p className="text-[9px] uppercase tracking-[.22em] text-slate-600">NOC intelligence</p>
          </div>
        </div>

        <h1 className="mt-6 text-lg font-semibold text-white">Sign in</h1>
        <p className="mt-1 text-xs text-slate-500">Use your technician login to access the operations console.</p>

        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300"><ShieldAlert size={14} className="mt-0.5 shrink-0" />{error}</div>}

        <div className="mt-5 space-y-3">
          <input autoFocus required placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className="form-input" autoComplete="username" />
          <input required type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="form-input" autoComplete="current-password" />
        </div>

        <button disabled={busy || !username.trim() || !password} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
