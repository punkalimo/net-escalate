import test from "node:test";
import assert from "node:assert/strict";

import { mergeDownstream, computeBlastRadius } from "../src/services/blastRadiusService.js";

function baseIncident(overrides = {}) {
  return { incidentId: "NET-1", device: "CORE-RTR-01", interfaceName: null, ...overrides };
}

test("mergeDownstream dedupes correlation children and impactedDevices by deviceId", () => {
  const merged = mergeDownstream(
    [{ deviceId: "dist-1", hostname: "DIST-1", interfaceName: null }],
    [{ deviceId: "dist-1", hostname: "DIST-1", attachedAt: new Date() }, { deviceId: "access-1", hostname: "ACCESS-1", attachedAt: new Date() }]
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(m => m.deviceId).sort(), ["access-1", "dist-1"]);
});

test("mergeDownstream falls back to hostname as the dedupe key when deviceId is missing", () => {
  const merged = mergeDownstream([{ hostname: "DIST-1", interfaceName: null }], [{ hostname: "DIST-1", attachedAt: new Date() }]);
  assert.equal(merged.length, 1);
});

test("computeBlastRadius counts the root plus every downstream device exactly once", () => {
  const deviceById = new Map([
    ["dist-1", { deviceId: "dist-1", hostname: "DIST-1", role: "edge", deviceType: "switch", status: "DOWN" }],
    ["access-1", { deviceId: "access-1", hostname: "ACCESS-1", role: "access", deviceType: "switch", status: "DOWN" }]
  ]);
  const result = computeBlastRadius(baseIncident(), {
    rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01", role: "core", location: "Lusaka HQ" },
    downstream: [{ deviceId: "dist-1", hostname: "DIST-1" }, { deviceId: "access-1", hostname: "ACCESS-1" }],
    deviceById
  });
  assert.equal(result.affectedDeviceCount, 3);
  assert.deepEqual(result.affectedDevices.sort(), ["ACCESS-1", "CORE-RTR-01", "DIST-1"]);
});

test("computeBlastRadius builds a root -> distribution -> access -> endpoints chain from Device.role", () => {
  const deviceById = new Map([
    ["dist-1", { deviceId: "dist-1", hostname: "DIST-1", role: "edge" }],
    ["access-1", { deviceId: "access-1", hostname: "ACCESS-1", role: "access" }],
    ["host-1", { deviceId: "host-1", hostname: "HOST-1", role: "host" }]
  ]);
  const result = computeBlastRadius(baseIncident(), {
    rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01", role: "core" },
    downstream: [{ deviceId: "dist-1", hostname: "DIST-1" }, { deviceId: "access-1", hostname: "ACCESS-1" }, { deviceId: "host-1", hostname: "HOST-1" }],
    deviceById
  });
  assert.deepEqual(result.chain.map(c => c.tier), ["ROOT", "DISTRIBUTION", "ACCESS", "ENDPOINTS"]);
  assert.equal(result.chain[0].label, "CORE-RTR-01");
});

test("computeBlastRadius reports sites affected without duplicates", () => {
  const deviceById = new Map([["access-1", { deviceId: "access-1", hostname: "ACCESS-1", location: "Lusaka HQ" }]]);
  const result = computeBlastRadius(baseIncident(), {
    rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01", location: "Lusaka HQ" },
    downstream: [{ deviceId: "access-1", hostname: "ACCESS-1" }],
    deviceById
  });
  assert.deepEqual(result.sitesAffected, ["Lusaka HQ"]);
});

test("computeBlastRadius surfaces an upstream device from the root's own parentDeviceId", () => {
  const deviceById = new Map([["isp-edge", { deviceId: "isp-edge", hostname: "ISP-EDGE", status: "UP" }]]);
  const result = computeBlastRadius(baseIncident(), {
    rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01", parentDeviceId: "isp-edge" },
    downstream: [],
    deviceById
  });
  assert.equal(result.upstreamDevice.hostname, "ISP-EDGE");
});

test("computeBlastRadius returns no upstream device when the root has no parent", () => {
  const result = computeBlastRadius(baseIncident(), { rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01" }, downstream: [], deviceById: new Map() });
  assert.equal(result.upstreamDevice, null);
});

test("computeBlastRadius with no downstream devices still reports a radius of 1 (itself)", () => {
  const result = computeBlastRadius(baseIncident(), { rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01" }, downstream: [], deviceById: new Map() });
  assert.equal(result.affectedDeviceCount, 1);
  assert.deepEqual(result.chain, [{ tier: "ROOT", label: "CORE-RTR-01", count: 1 }]);
});

test("computeBlastRadius derives servicesPotentiallyAffected from downstream device types, not fabricated service names", () => {
  const deviceById = new Map([
    ["host-1", { deviceId: "host-1", hostname: "HOST-1", deviceType: "server" }],
    ["host-2", { deviceId: "host-2", hostname: "HOST-2", deviceType: "server" }],
    ["printer-1", { deviceId: "printer-1", hostname: "PRN-1", deviceType: "printer" }]
  ]);
  const result = computeBlastRadius(baseIncident(), {
    rootDevice: { deviceId: "core-1", hostname: "CORE-RTR-01" },
    downstream: [{ deviceId: "host-1", hostname: "HOST-1" }, { deviceId: "host-2", hostname: "HOST-2" }, { deviceId: "printer-1", hostname: "PRN-1" }],
    deviceById
  });
  assert.ok(result.servicesPotentiallyAffected.includes("2 servers"));
  assert.ok(result.servicesPotentiallyAffected.includes("1 printer"));
});
