// Pure-logic coverage for the WebMCP human-approval gate
// (src/webmcp/security.js) - no DOM, no document.modelContext, no bundler
// needed, since this module is plain state management. This is what
// toolRegistry.js's registerActionTool() actually awaits before ever
// calling a consequential tool's run(), so this is the frontend half of
// "consequential actions require prior human approval" (the backend half
// is covered by backend/test/webmcpTools.test.js's APPROVAL_REQUIRED
// tests) - see docs/WEBMCP.md §7.
//
// Each test dynamically imports security.js with a unique cache-busting
// query string so it gets a fresh copy of the module's singleton state
// (activity/pendingApprovals/listeners are module-level, not exported) -
// tests would otherwise leak state into each other.
import test from "node:test";
import assert from "node:assert/strict";

let importCounter = 0;
async function freshSecurityModule() {
  importCounter += 1;
  return import(`../src/webmcp/security.js?test=${importCounter}`);
}

test("requestApproval creates a pending_approval entry and does not resolve on its own", async () => {
  const { requestApproval, getActivitySnapshot, hasPendingApprovals } = await freshSecurityModule();

  let resolved = false;
  const decision = requestApproval({ tool: "create_incident", summary: "Create a CRITICAL incident for Core-Router-01", detail: { device: "Core-Router-01" } });
  decision.then(() => { resolved = true; });

  const snapshot = getActivitySnapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].status, "pending_approval");
  assert.equal(snapshot[0].tool, "create_incident");
  assert.equal(hasPendingApprovals(), true);

  // Give any stray microtask a chance to run - the promise must still be
  // unresolved with no human decision yet. This is the actual gate:
  // nothing here ever auto-approves or times out.
  await new Promise(r => setTimeout(r, 20));
  assert.equal(resolved, false);
});

test("resolveApproval(id, true) approves: the entry moves to approved and the awaited decision reports approved:true", async () => {
  const { requestApproval, resolveApproval, getActivitySnapshot } = await freshSecurityModule();

  const decisionPromise = requestApproval({ tool: "assign_incident", summary: "Assign TECH-A2 to NET-1", detail: {} });
  const entry = getActivitySnapshot()[0];

  const resolved = resolveApproval(entry.id, true);
  assert.equal(resolved, true);

  const decision = await decisionPromise;
  assert.equal(decision.approved, true);
  assert.equal(getActivitySnapshot()[0].status, "approved");
});

test("resolveApproval(id, false, reason) rejects: no mutation is implied, the entry moves to rejected, and the reason round-trips", async () => {
  const { requestApproval, resolveApproval, getActivitySnapshot } = await freshSecurityModule();

  const decisionPromise = requestApproval({ tool: "add_incident_note", summary: "Add a note to NET-1", detail: {} });
  const entry = getActivitySnapshot()[0];

  resolveApproval(entry.id, false, "Rejected by the NOC engineer.");
  const decision = await decisionPromise;

  assert.equal(decision.approved, false);
  assert.equal(decision.reason, "Rejected by the NOC engineer.");
  assert.equal(getActivitySnapshot()[0].status, "rejected");
});

test("resolveApproval only settles the matching pending id, never a different or already-settled one", async () => {
  const { requestApproval, resolveApproval, hasPendingApprovals, getActivitySnapshot } = await freshSecurityModule();

  const first = requestApproval({ tool: "create_incident", summary: "first", detail: {} });
  const second = requestApproval({ tool: "create_incident", summary: "second", detail: {} });

  // Resolving an id that was never issued is a no-op, not a crash, and
  // must not accidentally settle anything pending.
  assert.equal(resolveApproval(999999, true), false);
  assert.equal(hasPendingApprovals(), true);

  const entries = getActivitySnapshot();
  const [firstEntry, secondEntry] = entries.filter(e => e.status === "pending_approval");

  resolveApproval(firstEntry.id, true);
  assert.equal((await first).approved, true);
  assert.equal(hasPendingApprovals(), true, "the second approval must still be pending");

  // Resolving the same (now-settled) id again must not throw or re-resolve.
  assert.equal(resolveApproval(firstEntry.id, false), false);

  resolveApproval(secondEntry.id, false, "no");
  assert.equal((await second).approved, false);
  assert.equal(hasPendingApprovals(), false);
});

test("logToolStart/logToolResult drive the running -> success/error activity states a read tool goes through", async () => {
  const { logToolStart, logToolResult, getActivitySnapshot } = await freshSecurityModule();

  const okEntry = logToolStart({ tool: "search_devices", classification: "read", summary: "Searching..." });
  assert.equal(getActivitySnapshot().find(e => e.id === okEntry.id).status, "running");
  logToolResult(okEntry.id, { status: "success", detail: { count: 2 } });
  assert.equal(getActivitySnapshot().find(e => e.id === okEntry.id).status, "success");

  const failEntry = logToolStart({ tool: "search_devices", classification: "read", summary: "Searching..." });
  logToolResult(failEntry.id, { status: "error", summary: "The tool call failed unexpectedly. No changes were made." });
  const failed = getActivitySnapshot().find(e => e.id === failEntry.id);
  assert.equal(failed.status, "error");
  assert.equal(failed.summary, "The tool call failed unexpectedly. No changes were made.");
});

test("subscribeActivity delivers an immediate snapshot and then every subsequent mutation, until unsubscribed", async () => {
  const { subscribeActivity, logToolStart, logToolResult } = await freshSecurityModule();

  const seen = [];
  const unsubscribe = subscribeActivity(snapshot => seen.push(snapshot.length));
  assert.equal(seen.length, 1, "subscribing delivers an immediate snapshot");
  assert.equal(seen[0], 0);

  const entry = logToolStart({ tool: "search_devices", classification: "read", summary: "x" });
  assert.equal(seen.length, 2);
  logToolResult(entry.id, { status: "success" });
  assert.equal(seen.length, 3);

  unsubscribe();
  logToolStart({ tool: "search_devices", classification: "read", summary: "y" });
  assert.equal(seen.length, 3, "no further notifications after unsubscribe");
});
