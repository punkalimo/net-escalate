import test from "node:test";
import assert from "node:assert/strict";

import { computeWeightedSeverity } from "../src/services/severityService.js";

test("base severity passes through unchanged with no weighting factors", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "medium" }), "medium");
});

test("core device role floors severity at high", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", deviceRole: "core" }), "high");
});

test("core device role never lowers an already-critical severity", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "critical", deviceRole: "core" }), "critical");
});

test("edge device role floors severity at medium", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", deviceRole: "edge" }), "medium");
});

test("access/host roles do not raise the fault's own severity", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", deviceRole: "access" }), "low");
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", deviceRole: "host" }), "low");
});

test("1-4 impacted devices raises severity to at least high", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", impactedDeviceCount: 1 }), "high");
  assert.equal(computeWeightedSeverity({ baseSeverity: "medium", impactedDeviceCount: 3 }), "high");
});

test("5+ impacted devices raises severity to critical", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", impactedDeviceCount: 5 }), "critical");
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", impactedDeviceCount: 20 }), "critical");
});

test("an incident active past the escalation window auto-promotes to critical", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", activeMinutes: 6, escalationMinutes: 5 }), "critical");
});

test("an incident under the escalation window is not auto-promoted", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", activeMinutes: 4, escalationMinutes: 5 }), "low");
});

test("escalation window is configurable per call", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", activeMinutes: 2, escalationMinutes: 1 }), "critical");
});

test("factors combine via the highest-wins rule, not additively past critical", () => {
  const result = computeWeightedSeverity({ baseSeverity: "critical", deviceRole: "core", impactedDeviceCount: 20, activeMinutes: 100, escalationMinutes: 5 });
  assert.equal(result, "critical", "must never exceed the critical ceiling");
});

test("unknown/missing device role does not throw and does not raise severity", () => {
  assert.equal(computeWeightedSeverity({ baseSeverity: "low", deviceRole: undefined }), "low");
});
