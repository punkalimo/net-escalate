import test from "node:test";
import assert from "node:assert/strict";

import { computeRootCause } from "../src/services/rootCauseService.js";

function baseIncident(overrides = {}) {
  return { incidentId: "NET-1", device: "CORE-RTR-01", source: "INTERFACE_HEALTH", description: "Interface Gi0/1 is DOWN.", interfaceName: "Gi0/1", createdAt: new Date("2026-08-27T02:14:32.000Z"), ...overrides };
}

test("never claims certainty: confidence is always below 100", () => {
  const result = computeRootCause(baseIncident(), {
    device: { hostname: "CORE-RTR-01", status: "DOWN" },
    children: Array.from({ length: 30 }, (_, i) => ({ hostname: `ACCESS-${i}`, interfaceName: null, createdAt: new Date("2026-08-27T02:14:50.000Z") }))
  });
  assert.ok(result.confidence < 100, "confidence must never reach 100");
});

test("labels a high-confidence analysis as Probable root cause", () => {
  const result = computeRootCause(baseIncident(), {
    device: { hostname: "CORE-RTR-01", status: "DOWN" },
    children: [{ hostname: "DIST-1", interfaceName: null, createdAt: new Date("2026-08-27T02:14:50.000Z") }]
  });
  assert.equal(result.label, "Probable root cause");
});

test("labels a low-confidence manual incident as Possible root cause, not Probable", () => {
  const result = computeRootCause(baseIncident({ source: "MANUAL", interfaceName: null }), { device: null, children: [] });
  assert.equal(result.label, "Possible root cause");
});

test("description includes the timing gap to the first downstream symptom", () => {
  const result = computeRootCause(baseIncident(), {
    device: { hostname: "CORE-RTR-01", status: "DOWN" },
    children: [{ hostname: "DIST-1", interfaceName: null, createdAt: new Date("2026-08-27T02:14:50.000Z") }]
  });
  assert.match(result.description, /18s before the first downstream device became unreachable/);
});

test("affectedDeviceCount is 1 plus the number of correlated children", () => {
  const result = computeRootCause(baseIncident(), {
    device: { hostname: "CORE-RTR-01" },
    children: [{ hostname: "A" }, { hostname: "B" }, { hostname: "C" }]
  });
  assert.equal(result.affectedDeviceCount, 4);
});

test("affectedDevices and affectedInterfaces are deduplicated", () => {
  const result = computeRootCause(baseIncident(), {
    device: { hostname: "CORE-RTR-01" },
    children: [{ hostname: "DIST-1", interfaceName: "Gi0/1" }, { hostname: "DIST-1", interfaceName: "Gi0/1" }]
  });
  assert.deepEqual(result.affectedDevices, ["CORE-RTR-01", "DIST-1"]);
  assert.deepEqual(result.affectedInterfaces, ["Gi0/1"]);
});

test("standalone incident (no children) still produces a usable description", () => {
  const result = computeRootCause(baseIncident({ interfaceName: null, description: "Device unreachable." , source: "DEVICE_MONITOR"}), { device: { hostname: "HOST-4", status: "DOWN" }, children: [] });
  assert.match(result.description, /Device reachability failure on HOST-4/);
  assert.equal(result.affectedDeviceCount, 1);
});

test("classifies flap, error-rate and CPU/memory wording distinctly from a plain interface DOWN", () => {
  const flap = computeRootCause(baseIncident({ description: "Interface Gi0/2 is flapping (5 transitions in 10 minutes)." }), { device: null, children: [] });
  const errorRate = computeRootCause(baseIncident({ description: "Interface Gi0/3 error/discard rate exceeded threshold." }), { device: null, children: [] });
  const cpu = computeRootCause(baseIncident({ source: "SYSTEM_HEALTH", interfaceName: null, description: "CPU utilization critical." }), { device: null, children: [] });
  const memory = computeRootCause(baseIncident({ source: "SYSTEM_HEALTH", interfaceName: null, description: "Memory utilization critical." }), { device: null, children: [] });
  assert.match(flap.description, /Interface flapping/);
  assert.match(errorRate.description, /error-rate degradation/);
  assert.match(cpu.description, /Device CPU pressure/);
  assert.match(memory.description, /Device memory pressure/);
});

test("a device reporting DOWN adds corroborating evidence, but a MANUAL incident does not credit an unrelated device's status", () => {
  const automatic = computeRootCause(baseIncident(), { device: { hostname: "CORE-RTR-01", status: "DOWN" }, children: [] });
  const manual = computeRootCause(baseIncident({ source: "MANUAL" }), { device: { hostname: "CORE-RTR-01", status: "DOWN" }, children: [] });
  assert.ok(automatic.evidence.some(e => e.includes("is currently reporting DOWN")));
  assert.ok(!manual.evidence.some(e => e.includes("is currently reporting DOWN")));
});
