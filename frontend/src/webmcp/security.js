// The human-confirmation gate for consequential WebMCP tools, plus the
// activity feed the "Agent Activity" panel (components/AgentActivityPanel.jsx)
// renders from.
//
// This is a real technical enforcement point, not a cosmetic one: a
// consequential tool's execute() (see toolRegistry.js's registerActionTool)
// calls requestApproval() and `await`s the Promise it returns *before*
// making any network request. That promise only resolves once a human
// clicks Approve/Reject in the UI (resolveApproval below) - there is no
// code path by which an agent's tool call reaches the backend without a
// human having made that decision first, because the fetch that would
// perform the action is literally inside the `then`, not run speculatively.
//
// This is a UX-layer safety control, not the security boundary itself -
// the backend's own auth/realm/role checks (attachRealmScope, etc. - see
// docs/WEBMCP.md) are what actually keep one realm's agent from touching
// another's data, and that boundary holds regardless of what happens here.
// What this gate adds is that within a realm the caller is *already
// allowed* to operate in, a write action still can't happen without the
// logged-in human explicitly saying yes.

const listeners = new Set();
const activity = [];
const pendingApprovals = new Map();
let nextId = 1;

function emit() {
  const snapshot = activity.slice(-200);
  for (const listener of listeners) listener(snapshot);
}

export function subscribeActivity(listener) {
  listeners.add(listener);
  listener(activity.slice(-200));
  return () => listeners.delete(listener);
}

export function getActivitySnapshot() {
  return activity.slice(-200);
}

function pushEntry(entry) {
  const withId = { id: nextId++, at: new Date().toISOString(), ...entry };
  activity.push(withId);
  emit();
  return withId;
}

export function logToolStart({ tool, classification, summary }) {
  return pushEntry({ tool, classification, summary, status: "running" });
}

export function logToolResult(entryId, { status, summary, detail = null }) {
  const idx = activity.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  activity[idx] = { ...activity[idx], status, summary: summary || activity[idx].summary, detail };
  emit();
}

// Creates a "pending approval" activity entry and returns a Promise that
// resolves with { approved: boolean, reason? } once resolveApproval() is
// called with the same id (wired to the Approve/Reject buttons in
// AgentActivityPanel.jsx). Never auto-resolves, never times out silently -
// an agent that calls a consequential tool and gets no human response
// simply waits, exactly like a human waiting on another human's sign-off.
export function requestApproval({ tool, summary, detail }) {
  const entry = pushEntry({ tool, classification: "write", summary, detail, status: "pending_approval" });
  return new Promise(resolve => {
    pendingApprovals.set(entry.id, resolve);
  }).then(decision => {
    activity[activity.findIndex(e => e.id === entry.id)] = { ...activity.find(e => e.id === entry.id), status: decision.approved ? "approved" : "rejected" };
    emit();
    return decision;
  });
}

export function resolveApproval(entryId, approved, reason = null) {
  const resolve = pendingApprovals.get(entryId);
  if (!resolve) return false;
  pendingApprovals.delete(entryId);
  resolve({ approved, reason });
  return true;
}

export function hasPendingApprovals() {
  return pendingApprovals.size > 0;
}

export default { subscribeActivity, getActivitySnapshot, logToolStart, logToolResult, requestApproval, resolveApproval, hasPendingApprovals };
