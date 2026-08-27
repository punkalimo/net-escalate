import test from "node:test";
import assert from "node:assert/strict";

import { evaluateInterfaceHealth, evaluateInterfaceErrorRate, updateFlapWindow, evaluateInterfaceFlap } from "../src/services/interfaceHealthService.js";

const HEALTHY_METRICS = { utilizationPercent: 5, inErrors: 0, outErrors: 0, inDiscards: 0, outDiscards: 0 };

test("admin-down interface never alerts, regardless of operational status (the core false-positive fix)", () => {
  // The exact bug report: an unused/never-configured port with ifOperStatus
  // down must not produce a DOWN incident just because it's operationally
  // down - only ifAdminStatus == up AND ifOperStatus == down should.
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "DOWN", null, { adminState: "DOWN", monitored: true });
  assert.equal(result.health, "ADMIN_DOWN");
  assert.notEqual(result.health, "DOWN");
  assert.notEqual(result.health, "CRITICAL");
});

test("admin-down interface never alerts even if operationally reported UP", () => {
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "UP", null, { adminState: "DOWN", monitored: true });
  assert.equal(result.health, "ADMIN_DOWN");
});

test("an interface whose admin state has never been synced (UNKNOWN) is not suppressed as admin-down", () => {
  // Regression check: adminState is "UNKNOWN" right after this field was
  // introduced on an existing record, or briefly after a server restart
  // before the first admin sync completes. Treating that the same as a
  // confirmed "DOWN" would hide a real fault on an actually admin-up
  // interface for as long as the sync stays stale.
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "DOWN", null, { adminState: "UNKNOWN", monitored: true });
  assert.equal(result.health, "DOWN", "an unsynced admin state must fall through to normal evaluation, not suppress");
});

test("admin-up AND oper-down is the only condition that creates a DOWN fault", () => {
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "DOWN", null, { adminState: "UP", monitored: true });
  assert.equal(result.health, "DOWN");
  assert.equal(result.severity, "critical");
});

test("monitored=false silences alerting even on an admin-up, oper-down interface", () => {
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "DOWN", null, { adminState: "UP", monitored: false });
  assert.equal(result.health, "UNMONITORED");
});

test("admin-up, oper-up, healthy traffic still evaluates normally", () => {
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "UP", null, { adminState: "UP", monitored: true });
  assert.equal(result.health, "HEALTHY");
});

test("utilization thresholds still fire normally for a monitored, admin-up interface", () => {
  const result = evaluateInterfaceHealth({ ...HEALTHY_METRICS, utilizationPercent: 96 }, "UP", null, { adminState: "UP", monitored: true });
  assert.equal(result.health, "CRITICAL");
});

test("defaults to monitored=true and no adminState when options are omitted (backward compatible)", () => {
  const result = evaluateInterfaceHealth(HEALTHY_METRICS, "DOWN");
  assert.equal(result.health, "DOWN", "omitting adminState must not silently suppress a real down interface");
});

test("cumulative error/discard counts no longer feed utilization health (the fixed absolute-threshold bug)", () => {
  // Before the fix, a lifetime total of >=10 errors permanently pushed
  // health to DEGRADED/CRITICAL even with zero recent errors. Utilization
  // health must now be purely utilization-driven; error/discard rate is a
  // wholly separate evaluator.
  const result = evaluateInterfaceHealth({ utilizationPercent: 5, inErrors: 999999, outErrors: 999999, inDiscards: 999999, outDiscards: 999999 }, "UP", null, { adminState: "UP", monitored: true });
  assert.equal(result.health, "HEALTHY");
});

test("evaluateInterfaceErrorRate: no delta yet is UNKNOWN, not a fault", () => {
  const result = evaluateInterfaceErrorRate({ errorRatePerMin: null, discardRatePerMin: null });
  assert.equal(result.state, "UNKNOWN");
});

test("evaluateInterfaceErrorRate: below warning rate is healthy", () => {
  const result = evaluateInterfaceErrorRate({ errorRatePerMin: 1, discardRatePerMin: 0 });
  assert.equal(result.state, "HEALTHY");
});

test("evaluateInterfaceErrorRate: rate rising above warning threshold degrades at low severity", () => {
  const result = evaluateInterfaceErrorRate({ errorRatePerMin: 6, discardRatePerMin: 0 });
  assert.equal(result.state, "DEGRADED");
  assert.equal(result.severity, "low");
});

test("evaluateInterfaceErrorRate: rate above critical threshold is still capped below the status pipeline's severity ceiling", () => {
  const result = evaluateInterfaceErrorRate({ errorRatePerMin: 100, discardRatePerMin: 0 });
  assert.equal(result.state, "DEGRADED");
  assert.notEqual(result.severity, "critical");
  assert.notEqual(result.severity, "high");
});

test("evaluateInterfaceErrorRate: in+out errors and discards combine", () => {
  const result = evaluateInterfaceErrorRate({ errorRatePerMin: 3, discardRatePerMin: 3 });
  assert.equal(result.state, "DEGRADED", "3+3=6/min should cross the default 5/min warning threshold");
});

test("evaluateInterfaceErrorRate: respects per-device threshold overrides", () => {
  const result = evaluateInterfaceErrorRate({ errorRatePerMin: 6, discardRatePerMin: 0 }, { errorRateWarningPerMin: 50 });
  assert.equal(result.state, "HEALTHY", "6/min should not fire against a raised 50/min override");
});

test("updateFlapWindow: appends a transition only on a real UP<->DOWN change", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const result = updateFlapWindow([], "UP", "DOWN", now, 10);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "DOWN");
});

test("updateFlapWindow: no transition recorded when state is unchanged", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const result = updateFlapWindow([], "UP", "UP", now, 10);
  assert.equal(result.length, 0);
});

test("updateFlapWindow: UNKNOWN transitions (e.g. a failed poll) are not counted as flaps", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const result = updateFlapWindow([], "UP", "UNKNOWN", now, 10);
  assert.equal(result.length, 0);
});

test("updateFlapWindow: prunes entries older than the window", () => {
  const now = new Date("2026-01-01T00:10:01Z");
  const old = [{ at: new Date("2026-01-01T00:00:00Z"), status: "DOWN" }];
  const result = updateFlapWindow(old, "UP", "UP", now, 10);
  assert.equal(result.length, 0, "an entry more than 10 minutes old must be pruned");
});

test("updateFlapWindow: keeps entries still inside the window", () => {
  const now = new Date("2026-01-01T00:05:00Z");
  const recent = [{ at: new Date("2026-01-01T00:00:00Z"), status: "DOWN" }];
  const result = updateFlapWindow(recent, "UP", "UP", now, 10);
  assert.equal(result.length, 1);
});

test("evaluateInterfaceFlap: at or below the default threshold (4) is not flapping", () => {
  const transitions = Array.from({ length: 4 }, (_, i) => ({ at: new Date(), status: i % 2 ? "UP" : "DOWN" }));
  const result = evaluateInterfaceFlap(transitions);
  assert.equal(result.isFlapping, false);
});

test("evaluateInterfaceFlap: more than the default threshold (4) is flapping", () => {
  const transitions = Array.from({ length: 5 }, (_, i) => ({ at: new Date(), status: i % 2 ? "UP" : "DOWN" }));
  const result = evaluateInterfaceFlap(transitions);
  assert.equal(result.isFlapping, true);
});

test("evaluateInterfaceFlap: respects a per-device count threshold override", () => {
  const transitions = Array.from({ length: 3 }, () => ({ at: new Date(), status: "DOWN" }));
  const result = evaluateInterfaceFlap(transitions, { flapCountThreshold: 2 });
  assert.equal(result.isFlapping, true, "3 transitions should exceed an overridden threshold of 2");
});
