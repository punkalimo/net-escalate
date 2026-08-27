import test from "node:test";
import assert from "node:assert/strict";

import { isDeviceAncestor, computeCorrelationGroupId, partitionManualIncidents, incidentDeviceMatches } from "../src/services/incidentCorrelationService.js";

test("isDeviceAncestor finds a direct parent", () => {
  const deviceById = new Map([["core-1", { deviceId: "core-1" }]]);
  const child = { deviceId: "access-1", parentDeviceId: "core-1" };
  assert.equal(isDeviceAncestor("core-1", child, deviceById), true);
});

test("isDeviceAncestor finds a multi-hop ancestor", () => {
  const deviceById = new Map([
    ["core-1", { deviceId: "core-1", parentDeviceId: null }],
    ["dist-1", { deviceId: "dist-1", parentDeviceId: "core-1" }]
  ]);
  const child = { deviceId: "access-1", parentDeviceId: "dist-1" };
  assert.equal(isDeviceAncestor("core-1", child, deviceById), true);
});

test("isDeviceAncestor returns false for an unrelated device", () => {
  const deviceById = new Map([["dist-1", { deviceId: "dist-1", parentDeviceId: null }]]);
  const child = { deviceId: "access-1", parentDeviceId: "dist-1" };
  assert.equal(isDeviceAncestor("core-1", child, deviceById), false);
});

test("isDeviceAncestor does not throw and returns false on a cycle", () => {
  const deviceById = new Map([
    ["a", { deviceId: "a", parentDeviceId: "b" }],
    ["b", { deviceId: "b", parentDeviceId: "a" }]
  ]);
  const child = { deviceId: "a", parentDeviceId: "b" };
  assert.equal(isDeviceAncestor("core-1", child, deviceById), false);
});

test("isDeviceAncestor returns false when the device has no parentDeviceId", () => {
  const deviceById = new Map();
  const child = { deviceId: "core-1", parentDeviceId: null };
  assert.equal(isDeviceAncestor("core-1", child, deviceById), false);
});

test("computeCorrelationGroupId keys off the root device, not the root incident", () => {
  const id = computeCorrelationGroupId({ deviceId: "core-1" }, { incidentId: "NET-1234" });
  assert.equal(id, "COR-core-1");
});

test("computeCorrelationGroupId stays the same across different root incidents on the same device", () => {
  const first = computeCorrelationGroupId({ deviceId: "core-1" }, { incidentId: "NET-1111" });
  const second = computeCorrelationGroupId({ deviceId: "core-1" }, { incidentId: "NET-2222" });
  assert.equal(first, second, "severity-driven root reselection must not rename the group");
});

test("computeCorrelationGroupId falls back to the incident id when there is no device", () => {
  const id = computeCorrelationGroupId(null, { incidentId: "NET-1234" });
  assert.equal(id, "COR-NET-1234");
});

test("partitionManualIncidents separates manually-locked incidents from automatic ones", () => {
  const incidents = [
    { incidentId: "NET-1", correlationManual: true },
    { incidentId: "NET-2", correlationManual: false },
    { incidentId: "NET-3" }
  ];
  const { manual, automatic } = partitionManualIncidents(incidents);
  assert.deepEqual(manual.map(i => i.incidentId), ["NET-1"]);
  assert.deepEqual(automatic.map(i => i.incidentId), ["NET-2", "NET-3"]);
});

test("incidentDeviceMatches prefers an exact deviceId match over fuzzy label matching", () => {
  const incident = { deviceId: "core-1", device: "Totally Different Label" };
  const device = { deviceId: "core-1", hostname: "CORE-1", ipAddress: "10.0.0.1" };
  assert.equal(incidentDeviceMatches(incident, device), true);
});

test("incidentDeviceMatches rejects a wrong deviceId even if the label would fuzzy-match", () => {
  const incident = { deviceId: "access-9", device: "CORE-1" };
  const device = { deviceId: "core-1", hostname: "CORE-1", ipAddress: "10.0.0.1" };
  assert.equal(incidentDeviceMatches(incident, device), false);
});

test("incidentDeviceMatches falls back to fuzzy label matching for deviceId-less (manual) incidents", () => {
  const incident = { deviceId: null, device: "CORE-1" };
  const device = { deviceId: "core-1", hostname: "CORE-1", ipAddress: "10.0.0.1" };
  assert.equal(incidentDeviceMatches(incident, device), true);
});
