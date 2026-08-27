import test from "node:test";
import assert from "node:assert/strict";

import { upsertDiscoveredInterfaces } from "../src/services/interfaceMonitoringService.js";

function discoveredItem(overrides = {}) {
  return {
    ifIndex: 1,
    ifDescr: "FastEthernet0/1",
    ifName: "Fa0/1",
    ifAlias: "",
    ifAdminStatus: 1,
    ifOperStatus: 1,
    highSpeed: 100,
    ifSpeed: 100000000,
    ifSpeedMbps: 100,
    duplex: "FULL",
    displayName: "Fa0/1",
    ifMtu: 1500,
    ifPhysAddress: "001122aabbcc",
    ...overrides
  };
}

test("upsertDiscoveredInterfaces creates a new interface, monitored=true when admin-up at discovery", () => {
  const result = upsertDiscoveredInterfaces([], [discoveredItem({ ifAdminStatus: 1 })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].monitored, true);
  assert.equal(result[0].adminState, "UP");
});

test("upsertDiscoveredInterfaces creates a new interface, monitored=false when admin-down at discovery", () => {
  const result = upsertDiscoveredInterfaces([], [discoveredItem({ ifIndex: 2, ifAdminStatus: 2, displayName: "Fa0/2" })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].monitored, false);
  assert.equal(result[0].adminState, "DOWN");
});

test("upsertDiscoveredInterfaces never wipes a manual monitored=true override on an admin-down port", () => {
  const existing = [{ ifIndex: 3, name: "Fa0/3", monitored: true, adminState: "DOWN", status: "DOWN", metrics: { health: "ADMIN_DOWN" } }];
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 3, ifAdminStatus: 2, displayName: "Fa0/3" })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].monitored, true, "manual override must survive re-discovery");
});

test("upsertDiscoveredInterfaces never wipes a manual monitored=false override on an admin-up port", () => {
  const existing = [{ ifIndex: 4, name: "Fa0/4", monitored: false, adminState: "UP", status: "UP", metrics: { health: "UNMONITORED" } }];
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 4, ifAdminStatus: 1, displayName: "Fa0/4" })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].monitored, false, "manual override must survive re-discovery");
});

test("upsertDiscoveredInterfaces preserves operational/health state (fast-poll domain) on re-discovery", () => {
  const existing = [{
    ifIndex: 5,
    name: "Fa0/5",
    monitored: true,
    adminState: "UP",
    status: "DOWN",
    lastCheckedAt: new Date("2026-01-01T00:00:00Z"),
    metrics: { health: "DOWN", healthScore: 0, activeIncidentId: "NET-1234", inOctets: 999 }
  }];
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 5, ifAdminStatus: 1, displayName: "Fa0/5" })]);
  assert.equal(result[0].status, "DOWN", "operational status is the fast poll's domain, discovery must not touch it");
  assert.equal(result[0].metrics.health, "DOWN");
  assert.equal(result[0].metrics.activeIncidentId, "NET-1234");
  assert.equal(result[0].metrics.inOctets, 999);
});

test("upsertDiscoveredInterfaces is keyed on ifIndex, not name (renamed interface keeps its history)", () => {
  const existing = [{ ifIndex: 6, name: "OldName", monitored: false, metrics: { activeIncidentId: "NET-9999" } }];
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 6, displayName: "NewName", ifDescr: "NewName" })]);
  assert.equal(result.length, 1, "must not create a duplicate row for the renamed interface");
  assert.equal(result[0].name, "NewName");
  assert.equal(result[0].monitored, false, "override survives a rename");
  assert.equal(result[0].metrics.activeIncidentId, "NET-9999");
});

test("upsertDiscoveredInterfaces updates admin state on transition and refreshes lastAdminSyncAt", () => {
  const existing = [{ ifIndex: 7, name: "Fa0/7", monitored: true, adminState: "DOWN", metrics: {} }];
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 7, ifAdminStatus: 1, displayName: "Fa0/7" })]);
  assert.equal(result[0].adminState, "UP");
  assert.ok(result[0].lastAdminSyncAt instanceof Date);
});

test("upsertDiscoveredInterfaces is a true upsert - never drops interfaces missing from a later discovery pass", () => {
  const existing = [
    { ifIndex: 1, name: "Fa0/1", monitored: true },
    { ifIndex: 2, name: "Fa0/2", monitored: true }
  ];
  // Only ifIndex 1 reported this time (e.g. a transient partial walk).
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 1 })]);
  assert.equal(result.length, 2, "interface 2's record must be preserved, not deleted");
});

test("upsertDiscoveredInterfaces persists MTU and formats the MAC address with colons on a new interface", () => {
  const result = upsertDiscoveredInterfaces([], [discoveredItem({ ifIndex: 8, ifMtu: 1500, ifPhysAddress: "aabbccddeeff" })]);
  assert.equal(result[0].metrics.mtu, 1500);
  assert.equal(result[0].metrics.macAddress, "aa:bb:cc:dd:ee:ff");
});

test("upsertDiscoveredInterfaces refreshes MTU/MAC on an existing interface", () => {
  const existing = [{ ifIndex: 9, name: "Fa0/9", monitored: true, metrics: { mtu: 1500, macAddress: "00:00:00:00:00:01" } }];
  const result = upsertDiscoveredInterfaces(existing, [discoveredItem({ ifIndex: 9, ifMtu: 9000, ifPhysAddress: "000000000002" })]);
  assert.equal(result[0].metrics.mtu, 9000, "a jumbo-frame MTU change should be picked up");
  assert.equal(result[0].metrics.macAddress, "00:00:00:00:00:02", "a MAC change (e.g. hardware swap) should be picked up");
});

test("upsertDiscoveredInterfaces ignores a malformed MAC rather than storing garbage", () => {
  const result = upsertDiscoveredInterfaces([], [discoveredItem({ ifIndex: 10, ifPhysAddress: "" })]);
  assert.equal(result[0].metrics.macAddress, null);
});
