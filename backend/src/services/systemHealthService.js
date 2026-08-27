import { syncFaultIncident } from "./faultIncidentService.js";

// Same threshold/incident pattern as interface utilization: a plain
// warning/critical percentage check. Device-level, so unlike interface
// health there's no admin/monitored gating - CPU and memory are always
// "in service" for a device that's up.
export function evaluateSystemMetricHealth(utilizationPercent, thresholds, label) {
  if (utilizationPercent == null) {
    return { health: "UNKNOWN", reasons: [`${label} is unavailable.`], severity: "low" };
  }

  const warning = Number.isFinite(Number(thresholds?.warning)) ? Number(thresholds.warning) : 80;
  const critical = Number.isFinite(Number(thresholds?.critical)) ? Number(thresholds.critical) : 95;

  if (utilizationPercent >= critical) {
    return { health: "CRITICAL", reasons: [`${label} is ${utilizationPercent.toFixed(1)}%, above ${critical}%.`], severity: "critical" };
  }
  if (utilizationPercent >= warning) {
    return { health: "WARNING", reasons: [`${label} is ${utilizationPercent.toFixed(1)}%, above ${warning}%.`], severity: "medium" };
  }
  return { health: "HEALTHY", reasons: [], severity: "low" };
}

function fingerprintFor(device, metricKind) {
  return `${device.deviceId}:SYSTEM_HEALTH:${metricKind}`;
}

export async function syncSystemHealthIncident({ device, metricKind, healthResult, currentIncidentId, currentLatched }) {
  const isRecovered = healthResult.health === "HEALTHY";
  const isFault = ["WARNING", "DEGRADED", "CRITICAL"].includes(healthResult.health);

  return syncFaultIncident({
    device,
    source: "SYSTEM_HEALTH",
    deviceLabel: device.hostname,
    isRecovered,
    isFault,
    severity: healthResult.severity,
    description: `Automatic system health alert: ${healthResult.reasons.join(" ")}`,
    fingerprint: fingerprintFor(device, metricKind),
    currentIncidentId,
    currentLatched
  });
}

export default { evaluateSystemMetricHealth, syncSystemHealthIncident };
