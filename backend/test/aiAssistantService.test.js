import test from "node:test";
import assert from "node:assert/strict";

import { extractIncidentId, matchIntent, answerForIntent } from "../src/services/aiAssistantService.js";

test("extractIncidentId finds a NET-#### id embedded in free text", () => {
  assert.equal(extractIncidentId("Why is NET-1234 critical?"), "NET-1234");
});

test("extractIncidentId finds an INC-###### id and normalizes case", () => {
  assert.equal(extractIncidentId("summarize inc-000123 for management"), "INC-000123");
});

test("extractIncidentId returns null when no incident id is present", () => {
  assert.equal(extractIncidentId("what devices are down right now"), null);
});

test("matchIntent recognizes each of the spec's own example questions", () => {
  assert.equal(matchIntent("Why is INC-000123 critical?"), "why_critical");
  assert.equal(matchIntent("What devices are affected?"), "what_affected");
  assert.equal(matchIntent("What is the probable root cause?"), "root_cause");
  assert.equal(matchIntent("What changed before the incident?"), "what_changed");
  assert.equal(matchIntent("Have we seen this before?"), "seen_before");
  assert.equal(matchIntent("What should I check first?"), "check_first");
  assert.equal(matchIntent("Which engineer is currently responsible?"), "who_responsible");
  assert.equal(matchIntent("How long until escalation?"), "escalation_time");
  assert.equal(matchIntent("Summarize this incident for management."), "summarize");
});

test("matchIntent returns null for a question that matches no known intent", () => {
  assert.equal(matchIntent("what is the meaning of life"), null);
});

function baseIncident(overrides = {}) {
  return { incidentId: "NET-1234", severity: "critical", severityReasons: ["Base severity from the detected fault: high.", "Root device role is core - floored at high."], description: "Interface Gi0/1 is DOWN.", status: "ESCALATING", escalationLevel: 2, technician: { name: "Jane Doe", role: "Network Engineer" }, ...overrides };
}

function baseContext(overrides = {}) {
  return {
    blastRadius: { affectedDeviceCount: 4, sitesAffected: ["Lusaka HQ"], affectedInterfaceCount: 1, downstreamDevices: [{ hostname: "SW-1" }, { hostname: "SW-2" }] },
    rootCause: { label: "Probable root cause", description: "Interface failure on CORE-RTR-01.", confidence: 90, evidence: ["Fault is scoped to interface Gi0/1."] },
    recommendedActions: { probableCause: "Interface failure", actions: ["Check physical link/optic.", "Check interface administrative status."] },
    changeCorrelation: null,
    similarIncidents: [],
    sla: { phase: "ACKNOWLEDGEMENT", overdue: false, minutesRemaining: 8, nextLevel: 3 },
    ...overrides
  };
}

test("answerForIntent 'why_critical' quotes the actual stored severityReasons, not a generic sentence", () => {
  const { answer, evidence } = answerForIntent("why_critical", baseIncident(), baseContext());
  assert.match(answer, /NET-1234 is critical severity/);
  assert.match(answer, /floored at high/);
  assert.deepEqual(evidence, baseIncident().severityReasons);
});

test("answerForIntent 'what_affected' reports the real blast radius numbers and downstream hostnames", () => {
  const { answer } = answerForIntent("what_affected", baseIncident(), baseContext());
  assert.match(answer, /4 device\(s\) affected across 1 site\(s\)/);
  assert.match(answer, /SW-1, SW-2/);
});

test("answerForIntent 'root_cause' surfaces the exact rootCause description and confidence", () => {
  const { answer } = answerForIntent("root_cause", baseIncident(), baseContext());
  assert.match(answer, /Interface failure on CORE-RTR-01/);
  assert.match(answer, /90% confidence/);
});

test("answerForIntent 'what_changed' is honest when no change was detected - never invents one", () => {
  const { answer } = answerForIntent("what_changed", baseIncident(), baseContext({ changeCorrelation: null }));
  assert.match(answer, /No configuration change was detected/);
});

test("answerForIntent 'what_changed' reports the real change when one exists", () => {
  const { answer } = answerForIntent("what_changed", baseIncident(), baseContext({ changeCorrelation: { hostname: "SW-2", timeDifferenceLabel: "4m 11s", changes: ["Configuration fingerprint changed"] } }));
  assert.match(answer, /SW-2/);
  assert.match(answer, /4m 11s/);
});

test("answerForIntent 'seen_before' is honest when nothing similar was found", () => {
  const { answer } = answerForIntent("seen_before", baseIncident(), baseContext({ similarIncidents: [] }));
  assert.match(answer, /No similar previous incident was found/);
});

test("answerForIntent 'seen_before' surfaces the top match's real previous resolution", () => {
  const { answer } = answerForIntent("seen_before", baseIncident(), baseContext({ similarIncidents: [{ incidentId: "NET-8847", similarity: 85, previousResolution: "Replaced faulty SFP module." }] }));
  assert.match(answer, /NET-8847/);
  assert.match(answer, /85% similar/);
  assert.match(answer, /Replaced faulty SFP module\./);
});

test("answerForIntent 'check_first' leads with the actual first recommended action", () => {
  const { answer } = answerForIntent("check_first", baseIncident(), baseContext());
  assert.match(answer, /Check physical link\/optic\./);
});

test("answerForIntent 'who_responsible' names the actual assigned technician and role", () => {
  const { answer } = answerForIntent("who_responsible", baseIncident(), baseContext());
  assert.match(answer, /Jane Doe \(Network Engineer\)/);
  assert.match(answer, /level 2/);
});

test("answerForIntent 'who_responsible' is honest when nobody is assigned", () => {
  const { answer } = answerForIntent("who_responsible", baseIncident({ technician: { name: null } }), baseContext());
  assert.match(answer, /No technician is currently assigned/);
});

test("answerForIntent 'escalation_time' reports the real SLA countdown", () => {
  const { answer } = answerForIntent("escalation_time", baseIncident(), baseContext());
  assert.match(answer, /8 minute\(s\) until escalation to level 3/);
});

test("answerForIntent 'escalation_time' flags an overdue SLA distinctly", () => {
  const { answer } = answerForIntent("escalation_time", baseIncident(), baseContext({ sla: { phase: "ACKNOWLEDGEMENT", overdue: true } }));
  assert.match(answer, /past its SLA deadline/);
});

test("answerForIntent falls back to a full summary for an unmatched/null intent", () => {
  const { answer } = answerForIntent(null, baseIncident(), baseContext());
  assert.match(answer, /NET-1234: CRITICAL/);
  assert.match(answer, /Jane Doe/);
});
