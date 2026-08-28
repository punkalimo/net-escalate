import test from "node:test";
import assert from "node:assert/strict";

import { configFields, fingerprint } from "../src/services/configSnapshotService.js";

function baseDevice(overrides = {}) {
  return {
    hostname: "CORE-RTR-01", ipAddress: "10.0.0.1", deviceType: "router", vendor: "Cisco", model: "ISR4451",
    monitoringMethods: ["icmp", "snmp"], monitoredPorts: [{ port: 22, protocol: "tcp", enabled: true }],
    snmp: { enabled: true, version: "2c" },
    interfaces: [{ ifIndex: 1, name: "Gi0/1", description: "WAN", adminState: "UP", monitored: true, metrics: { duplex: "FULL", speedMbps: 1000, mtu: 1500, inOctets: 1000, outOctets: 500, checkedAt: new Date(), health: "HEALTHY", healthScore: 100 } }],
    ...overrides
  };
}

test("configFields excludes live counters - the same device polled twice with only counters differing fingerprints identically", () => {
  const first = baseDevice();
  const second = baseDevice({ interfaces: [{ ...first.interfaces[0], metrics: { ...first.interfaces[0].metrics, inOctets: 999999, outOctets: 555555, checkedAt: new Date(Date.now() + 60000), health: "DEGRADED", healthScore: 40 } }] });
  assert.equal(fingerprint(configFields(first)), fingerprint(configFields(second)), "traffic counters/health/timestamps must never affect the config fingerprint");
});

test("configFields fingerprint changes when a genuinely configuration-like field changes (admin state)", () => {
  const first = baseDevice();
  const second = baseDevice({ interfaces: [{ ...first.interfaces[0], adminState: "DOWN" }] });
  assert.notEqual(fingerprint(configFields(first)), fingerprint(configFields(second)));
});

test("configFields fingerprint changes when the monitored flag changes", () => {
  const first = baseDevice();
  const second = baseDevice({ interfaces: [{ ...first.interfaces[0], monitored: false }] });
  assert.notEqual(fingerprint(configFields(first)), fingerprint(configFields(second)));
});

test("configFields fingerprint changes when duplex/speed/mtu changes", () => {
  const first = baseDevice();
  const second = baseDevice({ interfaces: [{ ...first.interfaces[0], metrics: { ...first.interfaces[0].metrics, duplex: "HALF" } }] });
  assert.notEqual(fingerprint(configFields(first)), fingerprint(configFields(second)));
});

test("configFields fingerprint changes when an interface is added or removed", () => {
  const first = baseDevice();
  const second = baseDevice({ interfaces: [...first.interfaces, { ifIndex: 2, name: "Gi0/2", description: "", adminState: "UP", monitored: true, metrics: {} }] });
  assert.notEqual(fingerprint(configFields(first)), fingerprint(configFields(second)));
});

test("configFields fingerprint is stable across repeated calls on unchanged data", () => {
  const device = baseDevice();
  assert.equal(fingerprint(configFields(device)), fingerprint(configFields(device)));
});
