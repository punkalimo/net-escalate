import { useEffect, useMemo, useState } from "react";
import { Bot, Check, CheckCircle2, ChevronRight, Loader2, Search, ShieldAlert, X, XCircle } from "lucide-react";
import { subscribeActivity, resolveApproval } from "../webmcp/index.js";

function openIncident(incidentId) {
  window.dispatchEvent(new CustomEvent("netescalate:open-incident", { detail: { incidentId } }));
}

const STATUS_ICON = {
  running: <Loader2 size={14} className="animate-spin text-blue-400" />,
  success: <CheckCircle2 size={14} className="text-emerald-400" />,
  error: <XCircle size={14} className="text-red-400" />,
  pending_approval: <ShieldAlert size={14} className="text-amber-400" />,
  approved: <Check size={14} className="text-emerald-400" />,
  rejected: <XCircle size={14} className="text-slate-500" />
};

const STATUS_LABEL = { running: "Running", success: "Done", error: "Failed", pending_approval: "Awaiting approval", approved: "Approved", rejected: "Rejected" };

function ApprovalCard({ entry }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex items-center gap-2 text-amber-300">
        <ShieldAlert size={15} />
        <span className="text-[10px] font-bold uppercase tracking-wider">Agent is requesting permission to...</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{entry.summary}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => resolveApproval(entry.id, true)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
          <Check size={13} /> Approve
        </button>
        <button onClick={() => resolveApproval(entry.id, false, "Rejected by the NOC engineer.")} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800">
          <X size={13} /> Reject
        </button>
      </div>
    </div>
  );
}

function Entry({ entry, onOpenInvestigation }) {
  const canOpenInvestigation = entry.tool === "investigate_incident" && entry.status === "success" && entry.detail?.incident;
  if (entry.status === "pending_approval") return <ApprovalCard entry={entry} />;
  return (
    <div
      onClick={() => canOpenInvestigation && onOpenInvestigation(entry.detail)}
      role={canOpenInvestigation ? "button" : undefined}
      tabIndex={canOpenInvestigation ? 0 : undefined}
      className={`rounded-xl border border-slate-800 bg-slate-950/40 p-3 ${canOpenInvestigation ? "cursor-pointer hover:border-cyan-500/30 hover:bg-slate-900/60" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5">{STATUS_ICON[entry.status] || <Loader2 size={14} />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-slate-300">{entry.tool}</span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase ${entry.classification === "write" ? "border-orange-500/20 bg-orange-500/5 text-orange-400" : "border-blue-500/20 bg-blue-500/5 text-blue-400"}`}>
              {entry.classification === "write" ? "consequential" : "read-only"}
            </span>
            <span className="text-[9px] text-slate-600">{STATUS_LABEL[entry.status] || entry.status}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{entry.summary}</p>
          {entry.status === "error" && entry.detail == null && <p className="mt-1 text-[11px] text-red-400">{entry.summary}</p>}
        </div>
        {canOpenInvestigation && <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-600" />}
      </div>
    </div>
  );
}

function ConfidenceMeter({ value }) {
  if (value == null) return <span className="text-slate-600">Not computed</span>;
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-orange-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs font-semibold text-slate-300">{pct}%</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">{title}</p>
      {children}
    </div>
  );
}

// The Agent Investigation workspace - rendered from an investigate_incident
// tool call's result. Deliberately structured as distinguishable
// observed/inferred/recommended sections (per docs/WEBMCP.md), not a
// chat transcript.
function InvestigationWorkspace({ data, onClose }) {
  const { incident, device, correlation, sla, rootCause, blastRadius, historicalMatches, possibleChangeCause, recommendedActions, confidence } = data;
  return (
    <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="absolute inset-0 flex h-full w-full flex-col bg-[#060b14]">
        <div className="flex items-center gap-4 border-b border-slate-800 px-5 py-4">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2.5 text-cyan-400"><Search size={19} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">Agent Investigation · {incident.incidentId}</h2>
            <p className="text-[10px] text-slate-600">Orchestrated from existing correlation, root-cause, blast-radius and SLA services</p>
          </div>
          <button onClick={() => openIncident(incident.incidentId)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Open incident</button>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="mx-auto max-w-5xl space-y-4">
            <Section title="Situation">
              <p className="text-sm text-slate-200">{incident.device} · {incident.location} · <span className="font-semibold uppercase">{incident.severity}</span></p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{incident.description}</p>
              <p className="mt-2 text-[11px] text-slate-600">Status {incident.status} · Escalation level {incident.escalationLevel} · Opened {incident.createdAt ? new Date(incident.createdAt).toLocaleString() : "—"}</p>
            </Section>

            <Section title="Evidence (observed facts)">
              <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <p><span className="text-slate-600">Device: </span>{device?.hostname || incident.device} ({device?.status || "unknown"})</p>
                <p><span className="text-slate-600">SLA phase: </span>{sla ? `${sla.phase}${sla.overdue ? " · OVERDUE" : ""}` : "n/a"}</p>
                <p><span className="text-slate-600">Assigned: </span>{incident.technician?.name || "Unassigned"}</p>
                <p><span className="text-slate-600">Source: </span>{incident.source}</p>
              </div>
            </Section>

            <Section title="Correlation">
              {correlation?.children?.length ? (
                <ul className="space-y-1 text-xs text-slate-400">
                  {correlation.children.map((c, i) => <li key={i}>• {c.hostname || c.device} {c.interfaceName ? `(${c.interfaceName})` : ""}</li>)}
                </ul>
              ) : <p className="text-xs text-slate-600">No correlated sibling incidents found.</p>}
            </Section>

            <Section title="Root cause (inferred)">
              <p className="text-sm font-semibold text-purple-300">{rootCause?.label || "Unknown"}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">{rootCause?.description}</p>
              {rootCause?.evidence?.length > 0 && <div className="mt-2 space-y-1">{rootCause.evidence.map((e, i) => <p key={i} className="text-[11px] text-slate-600">• {e}</p>)}</div>}
            </Section>

            <Section title="Blast radius (inferred)">
              <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                <p><span className="text-slate-600">Affected devices: </span>{blastRadius?.affectedDeviceCount ?? 0}</p>
                <p><span className="text-slate-600">Affected interfaces: </span>{blastRadius?.affectedInterfaceCount ?? 0}</p>
                <p><span className="text-slate-600">Sites affected: </span>{blastRadius?.sitesAffected?.join(", ") || "—"}</p>
                <p><span className="text-slate-600">Upstream device: </span>{blastRadius?.upstreamDevice?.hostname || "None known"}</p>
              </div>
            </Section>

            <Section title="Historical evidence">
              {historicalMatches?.length ? (
                <ul className="space-y-1 text-xs text-slate-400">
                  {historicalMatches.map((m, i) => <li key={i}>• {m.incidentId} ({m.similarity}% similar) — {m.previousResolution || "no resolution notes recorded"}</li>)}
                </ul>
              ) : <p className="text-xs text-slate-600">No similar historical incidents found.</p>}
              {possibleChangeCause && <p className="mt-2 text-xs text-amber-400">Possible change cause: {possibleChangeCause.label} on {possibleChangeCause.hostname}, {possibleChangeCause.timeDifferenceLabel} before the incident.</p>}
            </Section>

            <Section title="Recommended actions (suggestions only — not automatically taken)">
              <ul className="space-y-1 text-xs text-slate-300">
                {(recommendedActions?.actions || []).map((a, i) => <li key={i}>• {a}</li>)}
              </ul>
            </Section>

            <Section title="Confidence">
              <ConfidenceMeter value={confidence} />
              <p className="mt-2 text-[11px] text-slate-600">Confidence reflects the strength of available evidence, not certainty. Review before acting.</p>
            </Section>

            <Section title="Human decision">
              <p className="text-xs text-slate-500">This investigation is read-only. If the agent recommends creating an incident, assigning a technician, or adding a note, an approval card will appear in the Agent Activity feed for you to approve or reject.</p>
            </Section>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function AgentActivityPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [investigation, setInvestigation] = useState(null);

  useEffect(() => subscribeActivity(setEntries), []);

  const pendingCount = useMemo(() => entries.filter(e => e.status === "pending_approval").length, [entries]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-cyan-500/30 bg-[#0b1020]/95 px-3 py-3 text-xs font-bold text-cyan-300 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-[#11182a] sm:bottom-5"
        title="Open Agent Activity"
      >
        <Bot size={17} />
        <span className="hidden sm:inline">Agent Activity</span>
        {pendingCount > 0 && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] text-amber-300">{pendingCount} pending</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <aside className="absolute inset-0 flex h-full w-full flex-col bg-[#060b14]">
            <div className="flex items-center gap-4 border-b border-slate-800 px-5 py-4">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2.5 text-cyan-400"><Bot size={19} /></div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white">Agent Activity</h2>
                <p className="text-[10px] text-slate-600">Live feed of every WebMCP tool call made against this realm, in this browser tab</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="mx-auto max-w-2xl space-y-2.5">
                {!entries.length && (
                  <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center">
                    <Bot size={32} className="mx-auto text-slate-700" />
                    <p className="mt-3 text-sm font-semibold text-white">No agent activity yet</p>
                    <p className="mt-1 text-xs text-slate-600">NetEscalate is agent-ready. Once an AI agent calls a WebMCP tool through this session, its activity — and any approval requests — will appear here.</p>
                  </div>
                )}
                {entries.slice().reverse().map(entry => <Entry key={entry.id} entry={entry} onOpenInvestigation={setInvestigation} />)}
              </div>
            </div>
          </aside>
        </div>
      )}

      {investigation && <InvestigationWorkspace data={investigation} onClose={() => setInvestigation(null)} />}
    </>
  );
}
