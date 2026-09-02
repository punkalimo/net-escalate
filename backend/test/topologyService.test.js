import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { startInMemoryMongo, stopInMemoryMongo } from "../test-support/inMemoryMongo.mjs";
import Realm from "../src/models/Realm.js";
import Device from "../src/models/Device.js";
import { discoverTopology } from "../src/services/topologyService.js";

let realm;

test.before(async () => {
  await startInMemoryMongo();
  realm = await Realm.create({ name: "Topology Test Realm", slug: "topology-test" });
});

test.after(async () => {
  await stopInMemoryMongo();
});

test("a manually-set parentDeviceId produces a topology edge when SNMP is disabled (no real hardware needed)", async () => {
  const core = await Device.create({ deviceId: "DEV-CORE", realmId: realm._id, hostname: "core-router-01", ipAddress: "10.9.0.1", role: "core", status: "DEGRADED", monitoringMethods: ["icmp"] });
  await Device.create({ deviceId: "DEV-ACCESS", realmId: realm._id, hostname: "access-switch-01", ipAddress: "10.9.0.2", role: "access", parentDeviceId: core.deviceId, status: "UP", monitoringMethods: ["icmp"] });

  const topology = await discoverTopology(realm._id);
  assert.equal(topology.success, true);
  assert.equal(topology.nodes.length, 2);
  const edge = topology.edges.find(e => (e.source === "DEV-CORE" && e.target === "DEV-ACCESS") || (e.source === "DEV-ACCESS" && e.target === "DEV-CORE"));
  assert.ok(edge, "expected a manual topology edge between the core and access device");
  assert.equal(edge.protocol, "MANUAL");
  // core is DEGRADED, so the edge should reflect that even though the access switch itself is UP.
  assert.equal(edge.state, "DEGRADED");
});

test("a device with no parentDeviceId and SNMP disabled produces no edges, only a node", async () => {
  const realmB = await Realm.create({ name: "Topology Test Realm B", slug: "topology-test-b" });
  await Device.create({ deviceId: "DEV-LONE", realmId: realmB._id, hostname: "lone-switch", ipAddress: "10.9.1.1", monitoringMethods: ["icmp"] });

  const topology = await discoverTopology(realmB._id);
  assert.equal(topology.nodes.length, 1);
  assert.equal(topology.edges.length, 0);
});
