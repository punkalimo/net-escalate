import test from "node:test";
import assert from "node:assert/strict";

import { getEscalationPolicy, computeSlaStatus } from "../src/services/escalationPolicyService.js";

test("getEscalationPolicy returns tighter timeouts for higher severities", () => {
  const critical = getEscalationPolicy("critical");
  const low = getEscalationPolicy("low");
  assert.ok(critical.ackTimeoutMinutes < low.ackTimeoutMinutes);
  assert.ok(critical.resolutionTimeoutMinutes < low.resolutionTimeoutMinutes);
});

test("getEscalationPolicy falls back to medium for an unknown severity", () => {
  assert.deepEqual(getEscalationPolicy("nonsense"), getEscalationPolicy("medium"));
});

test("computeSlaStatus returns null for a resolved incident", () => {
  assert.equal(computeSlaStatus({ status: "RESOLVED", severity: "critical" }), null);
});

test("computeSlaStatus returns null with no incident", () => {
  assert.equal(computeSlaStatus(null), null);
});

test("ACKNOWLEDGEMENT phase counts down from the incident's createdAt when no call has been logged yet", () => {
  const now = Date.parse("2026-08-27T02:00:00.000Z");
  const incident = { status: "OPEN", severity: "critical", escalationLevel: 1, createdAt: new Date("2026-08-27T01:57:00.000Z"), escalationHistory: [] };
  const sla = computeSlaStatus(incident, { now });
  assert.equal(sla.phase, "ACKNOWLEDGEMENT");
  assert.equal(sla.minutesRemaining, 2); // 5 min critical ack timeout - 3 elapsed
  assert.equal(sla.overdue, false);
});

test("ACKNOWLEDGEMENT phase is overdue once the ack timeout has passed the latest call attempt", () => {
  const now = Date.parse("2026-08-27T02:10:00.000Z");
  const incident = { status: "CALLING", severity: "critical", escalationLevel: 1, createdAt: new Date("2026-08-27T02:00:00.000Z"), escalationHistory: [{ startedAt: new Date("2026-08-27T02:00:00.000Z"), status: "CALLING" }] };
  const sla = computeSlaStatus(incident, { now });
  assert.equal(sla.overdue, true);
  assert.equal(sla.minutesRemaining, 0);
});

test("RESOLUTION phase counts down from the acknowledgement timestamp, not incident creation", () => {
  const now = Date.parse("2026-08-27T02:10:00.000Z");
  const incident = {
    status: "ACKNOWLEDGED", severity: "critical", escalationLevel: 1, createdAt: new Date("2026-08-27T01:00:00.000Z"),
    escalationHistory: [{ startedAt: new Date("2026-08-27T02:00:00.000Z"), completedAt: new Date("2026-08-27T02:05:00.000Z"), status: "ACKNOWLEDGED" }]
  };
  const sla = computeSlaStatus(incident, { now });
  assert.equal(sla.phase, "RESOLUTION");
  assert.equal(sla.minutesRemaining, 10); // 15 min critical resolution timeout - 5 elapsed since ack
  assert.equal(sla.overdue, false);
});

test("RESOLUTION phase returns null if there is no ACKNOWLEDGED history entry to measure from", () => {
  const incident = { status: "ACKNOWLEDGED", severity: "critical", escalationLevel: 1, escalationHistory: [] };
  assert.equal(computeSlaStatus(incident), null);
});

test("nextLevel is capped at maxLevel, never suggesting a level beyond what exists", () => {
  const now = Date.parse("2026-08-27T02:10:00.000Z");
  const incident = { status: "CALLING", severity: "critical", escalationLevel: 3, createdAt: new Date("2026-08-27T02:00:00.000Z"), escalationHistory: [{ startedAt: new Date("2026-08-27T02:00:00.000Z"), status: "CALLING" }] };
  const sla = computeSlaStatus(incident, { now, maxLevel: 3 });
  assert.equal(sla.nextLevel, 3);
});

test("SEVERITY-BASED escalation: the same elapsed time is overdue for critical but not yet for low", () => {
  const now = Date.parse("2026-08-27T02:10:00.000Z");
  const startedAt = new Date("2026-08-27T02:00:00.000Z");
  const criticalIncident = { status: "CALLING", severity: "critical", escalationLevel: 1, createdAt: startedAt, escalationHistory: [{ startedAt, status: "CALLING" }] };
  const lowIncident = { status: "CALLING", severity: "low", escalationLevel: 1, createdAt: startedAt, escalationHistory: [{ startedAt, status: "CALLING" }] };
  assert.equal(computeSlaStatus(criticalIncident, { now }).overdue, true);
  assert.equal(computeSlaStatus(lowIncident, { now }).overdue, false);
});
