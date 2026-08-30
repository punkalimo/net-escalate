// Small shared primitives for the platform module, matching the visual
// language of NocDashboard.jsx's own local Stat/Badge (not exported there,
// so duplicated here at platform scope rather than reached into).
export function StatCard({ label, value, icon: Icon, tone = "purple", hint }) {
  const tones = { purple: "text-purple-400 bg-purple-500/10 border-purple-500/20", blue: "text-blue-400 bg-blue-500/10 border-blue-500/20", red: "text-red-400 bg-red-500/10 border-red-500/20", amber: "text-amber-400 bg-amber-500/10 border-amber-500/20", green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  return <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl shadow-black/10">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-white">{value}</p>{hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}</div>
      {Icon && <div className={`rounded-xl border p-3 ${tones[tone]}`}><Icon size={19} /></div>}
    </div>
  </div>;
}

export function Pill({ children, className = "" }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${className}`}>{children}</span>;
}

export const statusTone = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  suspended: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  disabled: "border-slate-700 bg-slate-800/60 text-slate-500"
};

export const severityTone = {
  critical: "border-red-500/30 bg-red-500/10 text-red-400",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  low: "border-blue-500/30 bg-blue-500/10 text-blue-400"
};

export function PageHeader({ icon: Icon, title, subtitle, action }) {
  return <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div><div className="flex items-center gap-2">{Icon && <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-2 text-purple-400"><Icon size={17} /></div>}<h1 className="text-2xl font-bold text-white">{title}</h1></div>{subtitle && <p className="mt-2 max-w-2xl text-sm text-slate-500">{subtitle}</p>}</div>
    {action}
  </div>;
}

export function LoadingRow({ label = "Loading…" }) {
  return <div className="p-12 text-center text-sm text-slate-600">{label}</div>;
}
