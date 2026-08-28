import test from "node:test";
import assert from "node:assert/strict";

import { computeWeightedSeverity, computeSeverityWithReasons } from "../src/services/severityService.js";

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

test("computeSeverityWithReasons always includes the base severity as the first reason", () => {
  const { reasons } = computeSeverityWithReasons({ baseSeverity: "medium" });
  assert.equal(reasons[0], "Base severity from the detected fault: medium.");
});

test("computeSeverityWithReasons and computeWeightedSeverity agree on the resulting severity", () => {
  const input = { baseSeverity: "low", deviceRole: "core", impactedDeviceCount: 6, activeMinutes: 10, escalationMinutes: 5 };
  assert.equal(computeSeverityWithReasons(input).severity, computeWeightedSeverity(input));
});

test("computeSeverityWithReasons explains a core-role floor", () => {
  const { reasons } = computeSeverityWithReasons({ baseSeverity: "low", deviceRole: "core" });
  assert.ok(reasons.some(r => r.includes("core") && r.includes("floored at high")));
});

test("computeSeverityWithReasons explains a downstream-device floor distinctly from a non-flooring mention", () => {
  const flooring = computeSeverityWithReasons({ baseSeverity: "low", impactedDeviceCount: 2 });
  assert.ok(flooring.reasons.some(r => r.includes("2 downstream device(s) affected - floored at high")));

  const nonFlooring = computeSeverityWithReasons({ baseSeverity: "critical", impactedDeviceCount: 2 });
  assert.ok(nonFlooring.reasons.some(r => r === "2 downstream device(s) affected."));
});

test("computeSeverityWithReasons floors at critical when 2+ sites are affected", () => {
  const { severity, reasons } = computeSeverityWithReasons({ baseSeverity: "low", sitesAffected: 2 });
  assert.equal(severity, "critical");
  assert.ok(reasons.some(r => r.includes("2 sites impacted - floored at critical")));
});

test("computeSeverityWithReasons does not floor severity for a single site", () => {
  const { severity } = computeSeverityWithReasons({ baseSeverity: "low", sitesAffected: 1 });
  assert.equal(severity, "low");
});

test("computeSeverityWithReasons notes affected interfaces without them driving severity alone", () => {
  const { severity, reasons } = computeSeverityWithReasons({ baseSeverity: "low", affectedInterfaceCount: 3 });
  assert.equal(severity, "low");
  assert.ok(reasons.some(r => r.includes("3 interface(s) affected")));
});

test("computeSeverityWithReasons explains the escalation-window auto-promotion", () => {
  const { reasons } = computeSeverityWithReasons({ baseSeverity: "low", activeMinutes: 10, escalationMinutes: 5 });
  assert.ok(reasons.some(r => r.includes("Active for 10m") && r.includes("auto-promoted to critical")));
});

test("computeSeverityWithReasons example matches the spec's own CRITICAL reasoning shape", () => {
  // "CRITICAL / Reason: Core router failure + 23 downstream devices affected + 2 sites impacted"
  const { severity, reasons } = computeSeverityWithReasons({ baseSeverity: "high", deviceRole: "core", impactedDeviceCount: 23, sitesAffected: 2 });
  assert.equal(severity, "critical");
  assert.ok(reasons.some(r => r.includes("23 downstream devices affected")));
  assert.ok(reasons.some(r => r.includes("2 sites impacted")));
});
