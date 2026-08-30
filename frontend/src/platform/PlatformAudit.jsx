import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { getAuditLog } from "../services/platformApi";
import { PageHeader, LoadingRow } from "./ui";

export default function PlatformAudit() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditLog().then(r => { if (r.success) setEntries(r.entries); }).finally(() => setLoading(false));
  }, []);

  return <div className="space-y-5">
    <PageHeader icon={ScrollText} title="Audit Log" subtitle="Privileged actions across the whole platform." />
    <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
      <div className="grid grid-cols-1 gap-3 border-b border-slate-800/80 bg-slate-950/50 px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-600 md:grid-cols-[160px_1fr_1fr_140px]"><span>Action</span><span>Actor</span><span>Target</span><span>When</span></div>
      {loading ? <LoadingRow /> : entries.length ? entries.map((entry, i) => <div key={i} className="grid items-center gap-3 border-b border-slate-800/70 px-5 py-3 last:border-0 md:grid-cols-[160px_1fr_1fr_140px]">
        <span className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">{entry.action.replaceAll("_", " ")}</span>
        <span className="truncate text-sm text-slate-300">{entry.actorName || "System"}</span>
        <span className="truncate font-mono text-xs text-slate-500">{entry.targetType}{entry.targetId ? ` · ${entry.targetId}` : ""}</span>
        <span className="text-xs text-slate-600">{new Date(entry.at).toLocaleString()}</span>
      </div>) : <div className="p-12 text-center text-sm text-slate-600">No audit entries yet.</div>}
    </section>
  </div>;
}
