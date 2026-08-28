import test from "node:test";
import assert from "node:assert/strict";

import { textSimilarity, scoreSimilarity } from "../src/services/historicalMatchService.js";

function incident(overrides = {}) {
  return { incidentId: "NET-1", deviceId: "core-1", device: "CORE-RTR-01", location: "Lusaka HQ", source: "INTERFACE_HEALTH", interfaceName: "Gi0/1", description: "Interface Gi0/1 is DOWN.", ...overrides };
}

test("textSimilarity is 0 for completely unrelated text", () => {
  assert.equal(textSimilarity("Interface Gi0/1 is DOWN.", "CPU utilization critical."), 0);
});

test("textSimilarity is 1 for identical text", () => {
  const value = textSimilarity("Interface Gi0/1 is DOWN.", "Interface Gi0/1 is DOWN.");
  assert.equal(value, 1);
});

test("textSimilarity is 0 with empty input on either side", () => {
  assert.equal(textSimilarity("", "Interface Gi0/1 is DOWN."), 0);
  assert.equal(textSimilarity("Interface Gi0/1 is DOWN.", ""), 0);
});

test("scoreSimilarity gives the highest score to an exact repeat: same device, interface, source, root cause, site", () => {
  const current = incident();
  const past = incident({ incidentId: "NET-OLD" });
  const { score, evidence } = scoreSimilarity(current, past);
  assert.ok(score >= 90, `expected a near-perfect match, got ${score}`);
  assert.ok(evidence.some(e => e.includes("Same device")));
  assert.ok(evidence.some(e => e.includes("Same interface")));
  assert.ok(evidence.some(e => e.includes("Same alert type")));
  assert.ok(evidence.some(e => e.includes("Same probable root cause category")));
  assert.ok(evidence.some(e => e.includes("Same site")));
});

test("scoreSimilarity credits an exact deviceId match over a mere device-label match", () => {
  // Keep every other factor deliberately weak (unrelated description, no
  // interface/source/site overlap) so the two candidates don't both saturate
  // the 100-point ceiling and mask the deviceId-vs-label difference.
  const current = { incidentId: "NET-1", deviceId: "core-1", device: "CORE-RTR-01", location: "Lusaka HQ", source: "INTERFACE_HEALTH", interfaceName: "Gi0/1", description: "Interface Gi0/1 is DOWN." };
  const sameId = { incidentId: "NET-A", deviceId: "core-1", device: "CORE-RTR-01", location: "Ndola Branch", source: "SYSTEM_HEALTH", interfaceName: null, description: "Unrelated CPU alert." };
  const differentIdSameLabel = { incidentId: "NET-B", deviceId: "core-1-replacement", device: "CORE-RTR-01", location: "Ndola Branch", source: "SYSTEM_HEALTH", interfaceName: null, description: "Unrelated CPU alert." };
  assert.ok(scoreSimilarity(current, sameId).score > scoreSimilarity(current, differentIdSameLabel).score);
});

test("scoreSimilarity falls back to device-label matching when the current incident has no deviceId (e.g. MANUAL)", () => {
  const current = incident({ deviceId: null });
  const past = incident({ incidentId: "NET-OLD", deviceId: null });
  const { evidence } = scoreSimilarity(current, past);
  assert.ok(evidence.some(e => e.includes("Same device label")));
});

test("scoreSimilarity gives a low score for an unrelated incident on a different device with a different fault", () => {
  const current = incident();
  const unrelated = { incidentId: "NET-UNRELATED", deviceId: "host-9", device: "HOST-9", location: "Ndola Branch", source: "SYSTEM_HEALTH", interfaceName: null, description: "CPU utilization critical." };
  const { score } = scoreSimilarity(current, unrelated);
  assert.ok(score < 20, `expected a low score for an unrelated incident, got ${score}`);
});

test("scoreSimilarity never exceeds 100", () => {
  const current = incident({ description: "Interface Gi0/1 is DOWN. Interface Gi0/1 is DOWN. Interface Gi0/1 is DOWN." });
  const past = incident({ incidentId: "NET-OLD" });
  assert.ok(scoreSimilarity(current, past).score <= 100);
});

test("scoreSimilarity distinguishes the same fault category on a different interface of the same device", () => {
  const current = incident();
  const sameDeviceDifferentInterface = incident({ incidentId: "NET-OLD", interfaceName: "Gi0/2" });
  const { evidence } = scoreSimilarity(current, sameDeviceDifferentInterface);
  assert.ok(!evidence.some(e => e.includes("Same interface")));
});
