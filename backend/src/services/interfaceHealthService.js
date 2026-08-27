import Incident from "../models/Incident.js";
import { syncFaultIncident } from "./faultIncidentService.js";

export const HEALTH_THRESHOLDS = {
  utilizationWarning: 70,
  utilizationDegraded: 85,
  utilizationCritical: 95
};

export const ERROR_RATE_THRESHOLDS = {
  warningPerMin: 5,
  criticalPerMin: 30
};

export const FLAP_DEFAULTS = {
  countThreshold: 4,
  windowMinutes: 10,
  cooldownMinutes: 5
};

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function pick(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

// Devices may override the utilization tiers (device.alertThresholds); any
// missing/invalid tier falls back to the global default below.
function resolveUtilizationThresholds(overrides) {
  return {
    utilizationWarning: pick(overrides?.utilizationWarning, HEALTH_THRESHOLDS.utilizationWarning),
    utilizationDegraded: pick(overrides?.utilizationDegraded, HEALTH_THRESHOLDS.utilizationDegraded),
    utilizationCritical: pick(overrides?.utilizationCritical, HEALTH_THRESHOLDS.utilizationCritical)
  };
}

function resolveErrorRateThresholds(overrides) {
  return {
    warningPerMin: pick(overrides?.errorRateWarningPerMin, ERROR_RATE_THRESHOLDS.warningPerMin),
    criticalPerMin: pick(overrides?.errorRateCriticalPerMin, ERROR_RATE_THRESHOLDS.criticalPerMin)
  };
}

function resolveFlapThresholds(overrides) {
  return {
    countThreshold: pick(overrides?.flapCountThreshold, FLAP_DEFAULTS.countThreshold),
    windowMinutes: pick(overrides?.flapWindowMinutes, FLAP_DEFAULTS.windowMinutes),
    cooldownMinutes: pick(overrides?.flapCooldownMinutes, FLAP_DEFAULTS.cooldownMinutes)
  };
}

// operState: this interface's current ifOperStatus, as "UP"/"DOWN"/"UNKNOWN".
// adminState: its ifAdminStatus, synced on the slow cadence (see
// interfaceMonitoringService's admin sync) - never re-fetched on the fast
// poll that produces `metrics`, so this reflects the last deliberate config
// change, not a same-cycle value.
// monitored: per-interface opt-in/opt-out (Interface.monitored), defaulted
// at discovery and preserved across re-discovery.
//
// An interface that is administratively down was never plugged in, was
// deliberately shut down, or is otherwise not expected to be passing
// traffic - its operational state being down too is not a fault, so it must
// never generate an incident, regardless of ifOperStatus. This is checked
// ahead of and independently from the `monitored` opt-out: even an
// interface an operator explicitly re-enabled monitoring on should not
// alert while it is still administratively down.
//
// This function only ever evaluates utilization/status - error/discard
// RATE (a separate fault axis, see evaluateInterfaceErrorRate) and flapping
// (evaluateInterfaceFlap) are deliberately not folded in here, so a rising
// error rate can't silently get buried inside the same health tier as
// utilization, and each produces its own independent incident.
export function evaluateInterfaceHealth(metrics, operState, utilizationThresholdOverrides, { adminState, monitored = true } = {}) {
  if (monitored === false) {
    return { health: "UNMONITORED", score: null, reasons: ["Interface monitoring is disabled for this interface."], severity: "low" };
  }

  // Deliberately checks for an explicit "DOWN", not merely "not UP": an
  // interface whose admin state has never been synced yet (adminState is
  // "UNKNOWN", e.g. right after this field was introduced, or briefly after
  // a server restart before the first admin sync completes) must fall
  // through to normal evaluation below, not be silently suppressed as if
  // it were confirmed admin-down - that would hide a real fault on an
  // actually admin-up interface for as long as the sync stays stale.
  if (adminState === "DOWN") {
    return { health: "ADMIN_DOWN", score: null, reasons: ["Interface is administratively down (unused/unconfigured port)."], severity: "low" };
  }

  if (operState === "DOWN") {
    return { health: "DOWN", score: 0, reasons: ["Interface is administratively up but operationally DOWN."], severity: "critical" };
  }

  if (operState !== "UP" || !metrics) {
    return { health: "UNKNOWN", score: null, reasons: ["Interface metrics are unavailable."], severity: "low" };
  }

  const thresholds = resolveUtilizationThresholds(utilizationThresholdOverrides);
  const utilization = metrics.utilizationPercent == null ? 0 : finite(metrics.utilizationPercent);
  const reasons = [];
  let health = "HEALTHY";
  let severity = "low";

  if (utilization >= thresholds.utilizationCritical) {
    health = "CRITICAL";
    severity = "critical";
    reasons.push(`Utilization is ${utilization.toFixed(1)}%, above ${thresholds.utilizationCritical}%.`);
  } else if (utilization >= thresholds.utilizationDegraded) {
    health = "DEGRADED";
    severity = "high";
    reasons.push(`Utilization is ${utilization.toFixed(1)}%, above ${thresholds.utilizationDegraded}%.`);
  } else if (utilization >= thresholds.utilizationWarning) {
    health = "WARNING";
    severity = "medium";
    reasons.push(`Utilization is ${utilization.toFixed(1)}%, above ${thresholds.utilizationWarning}%.`);
  }

  const score = Math.max(0, Math.min(100, 100 - Math.min(100, utilization)));
  return { health, score: Number(score.toFixed(1)), reasons, severity };
}

// Error/discard RATE (per minute, from a counter delta over the actual
// sample interval) - not the raw cumulative SNMP counters, which only ever
// increase and would otherwise make an interface alert forever once it
// crossed an absolute lifetime total. Only meaningful when the caller has
// already confirmed the interface is eligible (admin-up, monitored,
// oper-up) - this function doesn't repeat that gating.
//
// state UNKNOWN means no counter delta was available yet (e.g. the first
// poll after discovery) - callers should treat that like the utilization
// evaluator's UNKNOWN: neither a fault nor proof of recovery.
export function evaluateInterfaceErrorRate({ errorRatePerMin, discardRatePerMin }, overrides) {
  if (errorRatePerMin == null && discardRatePerMin == null) {
    return { state: "UNKNOWN", severity: "low", reasons: ["No counter delta available yet to compute an error rate."] };
  }

  const thresholds = resolveErrorRateThresholds(overrides);
  const combinedRate = (errorRatePerMin || 0) + (discardRatePerMin || 0);

  if (combinedRate >= thresholds.criticalPerMin) {
    return { state: "DEGRADED", severity: "medium", reasons: [`Interface errors/discards rising at ${combinedRate.toFixed(1)}/min, above ${thresholds.criticalPerMin}/min.`] };
  }
  if (combinedRate >= thresholds.warningPerMin) {
    return { state: "DEGRADED", severity: "low", reasons: [`Interface errors/discards rising at ${combinedRate.toFixed(1)}/min, above ${thresholds.warningPerMin}/min.`] };
  }
  return { state: "HEALTHY", severity: "low", reasons: [] };
}

// Prunes transitions older than the configured window and appends the
// current cycle's transition if operational state actually changed since
// the previous poll. `now` is passed in explicitly (not read internally) so
// this stays a pure, easily-testable function.
export function updateFlapWindow(previousTransitions, previousOperState, currentOperState, now, windowMinutes) {
  const windowMs = windowMinutes * 60 * 1000;
  const pruned = (previousTransitions || []).filter(entry => now.getTime() - new Date(entry.at).getTime() <= windowMs);
  const isRealTransition = ["UP", "DOWN"].includes(previousOperState) && ["UP", "DOWN"].includes(currentOperState) && previousOperState !== currentOperState;
  if (isRealTransition) pruned.push({ at: now, status: currentOperState });
  return pruned;
}

// Pure threshold check over an already-windowed transition list.
export function evaluateInterfaceFlap(transitions, overrides) {
  const thresholds = resolveFlapThresholds(overrides);
  const count = (transitions || []).length;
  return { isFlapping: count > thresholds.countThreshold, transitionCount: count, thresholds };
}

function faultFingerprint(device, iface, kind, subtype) {
  return `${device.deviceId}:INTERFACE_HEALTH:${Number(iface.ifIndex)}:${kind}:${subtype}`;
}

export async function syncInterfaceIncident({ device, iface, healthResult }) {
  const interfaceMetrics = iface.metrics || {};
  const type = healthResult.health === "DOWN"
    ? "DOWN"
    : healthResult.health === "CRITICAL"
      ? "CRITICAL"
      : healthResult.health === "DEGRADED"
        ? "DEGRADED"
        : "WARNING";

  // UNKNOWN means we cannot prove recovery. Only a confirmed HEALTHY poll -
  // or the interface being administratively shut down/unmonitored, which by
  // policy can never be an active fault - is allowed to release an outage
  // latch.
  const isRecovered = ["HEALTHY", "ADMIN_DOWN", "UNMONITORED"].includes(healthResult.health);
  const isFault = ["DOWN", "DEGRADED", "CRITICAL"].includes(healthResult.health);

  return syncFaultIncident({
    device,
    source: "INTERFACE_HEALTH",
    deviceLabel: `${device.hostname} / ${iface.name}`,
    interfaceName: iface.name,
    interfaceIndex: Number(iface.ifIndex),
    isRecovered,
    isFault,
    severity: healthResult.severity,
    description: `Automatic interface health alert: ${healthResult.reasons.join(" ")}`,
    fingerprint: faultFingerprint(device, iface, "STATUS", type),
    currentIncidentId: interfaceMetrics.activeIncidentId || null,
    currentLatched: interfaceMetrics.incidentLatched === true
  });
}

export async function syncInterfaceDegradationIncident({ device, iface, errorRateResult }) {
  const interfaceMetrics = iface.metrics || {};
  return syncFaultIncident({
    device,
    source: "INTERFACE_HEALTH",
    deviceLabel: `${device.hostname} / ${iface.name}`,
    interfaceName: iface.name,
    interfaceIndex: Number(iface.ifIndex),
    isRecovered: errorRateResult.state === "HEALTHY",
    isFault: errorRateResult.state === "DEGRADED",
    severity: errorRateResult.severity,
    description: `Interface degradation detected: ${errorRateResult.reasons.join(" ")}`,
    fingerprint: faultFingerprint(device, iface, "DEGRADATION", "ERROR_RATE"),
    currentIncidentId: interfaceMetrics.degradationIncidentId || null,
    currentLatched: interfaceMetrics.degradationIncidentLatched === true
  });
}

export async function syncInterfaceFlapIncident({ device, iface, flapResult, statusIncidentIdToFold }) {
  const flapState = iface.flap || {};
  const result = await syncFaultIncident({
    device,
    source: "INTERFACE_HEALTH",
    deviceLabel: `${device.hostname} / ${iface.name}`,
    interfaceName: iface.name,
    interfaceIndex: Number(iface.ifIndex),
    isRecovered: !flapResult.isFlapping,
    isFault: flapResult.isFlapping,
    severity: "high",
    description: `Interface is flapping: ${flapResult.transitionCount} state changes in the last ${flapResult.thresholds.windowMinutes} minute(s).`,
    fingerprint: faultFingerprint(device, iface, "FLAP", "STATE_CHANGE"),
    currentIncidentId: flapState.incidentId || null,
    currentLatched: flapState.incidentLatched === true
  });

  // A flap incident just opened for the first time: fold any currently-open
  // status incident into it rather than leaving two open incidents for what
  // is really one disruptive pattern.
  if (result.incidentId && result.incidentId !== flapState.incidentId && statusIncidentIdToFold) {
    const folded = await Incident.findOneAndUpdate(
      { incidentId: statusIncidentIdToFold, status: { $ne: "RESOLVED" } },
      { status: "RESOLVED", resolvedAt: new Date(), $set: { description: `Superseded by flap incident ${result.incidentId}: this interface is flapping rather than experiencing a single sustained outage.` } },
      { new: true }
    );
    if (folded && global.io) global.io.emit("incident_updated", folded);
  }

  return result;
}

export default { evaluateInterfaceHealth, evaluateInterfaceErrorRate, updateFlapWindow, evaluateInterfaceFlap, syncInterfaceIncident, syncInterfaceDegradationIncident, syncInterfaceFlapIncident };
