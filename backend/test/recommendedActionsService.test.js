import test from "node:test";
import assert from "node:assert/strict";

import { computeRecommendedActions } from "../src/services/recommendedActionsService.js";

function baseIncident(overrides = {}) {
  return { incidentId: "NET-1", device: "CORE-RTR-01", source: "INTERFACE_HEALTH", description: "Interface Gi0/1 is DOWN.", interfaceName: "Gi0/1", ...overrides };
}

test("matches the spec's own WAN interface failure example on an edge/core device", () => {
  const result = computeRecommendedActions(baseIncident(), { device: { hostname: "CORE-RTR-01", role: "core" } });
  assert.equal(result.probableCause, "Interface failure");
  assert.deepEqual(result.actions, [
    "Check physical link/optic.",
    "Check interface administrative status.",
    "Check interface errors.",
    "Check remote interface.",
    "Verify upstream connectivity.",
    "Check ISP circuit status.",
    "Escalate to ISP if required."
  ]);
});

test("does not suggest ISP escalation for an access-role device (not contextually plausible)", () => {
  const result = computeRecommendedActions(baseIncident(), { device: { hostname: "SW-2", role: "access" } });
  assert.ok(!result.actions.some(a => a.toLowerCase().includes("isp")));
});

test("does not suggest ISP escalation when the device role is unknown", () => {
  const result = computeRecommendedActions(baseIncident(), { device: null });
  assert.ok(!result.actions.some(a => a.toLowerCase().includes("isp")));
});

test("flapping incidents get flap-specific steps, not the generic interface-down list", () => {
  const result = computeRecommendedActions(baseIncident({ description: "Interface Gi0/2 is flapping (5 transitions in 10 minutes)." }), { device: { hostname: "SW-1", role: "access" } });
  assert.equal(result.probableCause, "Interface flapping");
  assert.ok(result.actions.some(a => a.includes("disabling the port")));
});

test("error-rate degradation gets cabling/CRC-specific steps interpolated with the actual interface", () => {
  const result = computeRecommendedActions(baseIncident({ interfaceName: "Gi0/3", description: "Interface Gi0/3 error/discard rate exceeded threshold." }), { device: { hostname: "SW-1" } });
  assert.equal(result.probableCause, "Interface error-rate degradation");
  assert.ok(result.actions.some(a => a.includes("CRC")));
  assert.ok(result.actions.some(a => a.includes("Gi0/3")));
});

test("device CPU pressure steps reference the actual hostname, not a placeholder", () => {
  const result = computeRecommendedActions(baseIncident({ source: "SYSTEM_HEALTH", interfaceName: null, description: "CPU utilization critical." }), { device: { hostname: "CORE-RTR-01" } });
  assert.equal(result.probableCause, "Device CPU pressure");
  assert.ok(result.actions.some(a => a.includes("CORE-RTR-01")));
});

test("device memory pressure gets its own distinct step list from CPU pressure", () => {
  const cpu = computeRecommendedActions(baseIncident({ source: "SYSTEM_HEALTH", interfaceName: null, description: "CPU utilization critical." }), { device: { hostname: "X" } });
  const memory = computeRecommendedActions(baseIncident({ source: "SYSTEM_HEALTH", interfaceName: null, description: "Memory utilization critical." }), { device: { hostname: "X" } });
  assert.notDeepEqual(cpu.actions, memory.actions);
});

test("device reachability failure includes an on-site escalation step", () => {
  const result = computeRecommendedActions(baseIncident({ source: "DEVICE_MONITOR", interfaceName: null, description: "Device unreachable." }), { device: { hostname: "HOST-4" } });
  assert.ok(result.actions.some(a => a.toLowerCase().includes("on-site")));
});

test("a manual incident with no monitoring signal falls back to a generic-but-honest step list", () => {
  const result = computeRecommendedActions(baseIncident({ source: "MANUAL", interfaceName: null, description: "Reported by a user." }), { device: { hostname: "HOST-1" } });
  assert.equal(result.probableCause, "Reported fault");
  assert.ok(result.actions.length > 0);
});

test("adds a priority context note only when the blast radius actually has downstream devices", () => {
  const withRadius = computeRecommendedActions(baseIncident(), { device: { hostname: "CORE-RTR-01", role: "core" }, blastRadius: { affectedDeviceCount: 4 } });
  const withoutRadius = computeRecommendedActions(baseIncident(), { device: { hostname: "CORE-RTR-01", role: "core" }, blastRadius: { affectedDeviceCount: 1 } });
  assert.ok(withRadius.contextNotes.some(n => n.includes("3 downstream device(s)")));
  assert.equal(withoutRadius.contextNotes.length, 0);
});
