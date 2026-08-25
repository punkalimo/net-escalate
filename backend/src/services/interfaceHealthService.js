import Incident from "../models/Incident.js";
import Technician from "../models/Technician.js";

export const HEALTH_THRESHOLDS = {
  utilizationWarning: 70,
  utilizationDegraded: 85,
  utilizationCritical: 95,
  errorsWarning: 10,
  errorsCritical: 100,
  discardsWarning: 10,
  discardsCritical: 100
};

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function evaluateInterfaceHealth(metrics, status) {
  if (status === "DOWN") {
    return { health: "DOWN", score: 0, reasons: ["Interface is operationally DOWN."], severity: "critical" };
  }

  if (status !== "UP" || !metrics) {
    return { health: "UNKNOWN", score: null, reasons: ["Interface metrics are unavailable."], severity: "low" };
  }

  const utilization = metrics.utilizationPercent == null ? 0 : finite(metrics.utilizationPercent);
  const errors = finite(metrics.inErrors) + finite(metrics.outErrors);
  const discards = finite(metrics.inDiscards) + finite(metrics.outDiscards);
  const reasons = [];
  let health = "HEALTHY";
  let severity = "low";

  if (utilization >= HEALTH_THRESHOLDS.utilizationCritical) {
    health = "CRITICAL";
    severity = "critical";
    reasons.push(`Utilization is ${utilization.toFixed(1)}%, above ${HEALTH_THRESHOLDS.utilizationCritical}%.`);
  } else if (utilization >= HEALTH_THRESHOLDS.utilizationDegraded) {
    health = "DEGRADED";
    severity = "high";
    reasons.push(`Utilization is ${utilization.toFixed(1)}%, above ${HEALTH_THRESHOLDS.utilizationDegraded}%.`);
  } else if (utilization >= HEALTH_THRESHOLDS.utilizationWarning) {
    health = "WARNING";
    severity = "medium";
    reasons.push(`Utilization is ${utilization.toFixed(1)}%, above ${HEALTH_THRESHOLDS.utilizationWarning}%.`);
  }

  if (errors >= HEALTH_THRESHOLDS.errorsCritical) {
    health = "CRITICAL";
    severity = "critical";
    reasons.push(`${errors} interface errors detected.`);
  } else if (errors >= HEALTH_THRESHOLDS.errorsWarning && health !== "CRITICAL") {
    if (health === "HEALTHY") health = "DEGRADED";
    severity = severity === "low" ? "high" : severity;
    reasons.push(`${errors} interface errors detected.`);
  }

  if (discards >= HEALTH_THRESHOLDS.discardsCritical) {
    health = "CRITICAL";
    severity = "critical";
    reasons.push(`${discards} packet discards detected.`);
  } else if (discards >= HEALTH_THRESHOLDS.discardsWarning && health !== "CRITICAL") {
    if (health === "HEALTHY") health = "DEGRADED";
    severity = severity === "low" ? "high" : severity;
    reasons.push(`${discards} packet discards detected.`);
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      100 - Math.min(70, utilization * 0.7) - Math.min(20, errors * 0.2) - Math.min(10, discards * 0.1)
    )
  );

  return { health, score: Number(score.toFixed(1)), reasons, severity };
}

function generateIncidentId() {
  return `NET-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function getLevelOneTechnician() {
  return Technician.findOne({ active: true, level: 1 }).sort({ createdAt: 1 }).lean();
}

export async function syncInterfaceIncident({ device, iface, healthResult }) {
  const activeIncidentId = iface.metrics?.activeIncidentId || null;

  if (["HEALTHY", "WARNING", "UNKNOWN"].includes(healthResult.health)) {
    if (activeIncidentId) {
      const resolved = await Incident.findOneAndUpdate(
        { incidentId: activeIncidentId, status: { $ne: "RESOLVED" } },
        { status: "RESOLVED", resolvedAt: new Date() },
        { new: true }
      );
      if (resolved && global.io) global.io.emit("incident_updated", resolved);
    }
    return null;
  }

  if (activeIncidentId) return activeIncidentId;

  const technician = await getLevelOneTechnician();
  if (!technician?.phone) {
    console.warn(`[INTERFACE HEALTH] No active level 1 technician; incident not created for ${device.hostname} ${iface.name}`);
    return null;
  }

  const incident = await Incident.create({
    incidentId: generateIncidentId(),
    device: `${device.hostname} / ${iface.name}`,
    location: device.location || "Unknown location",
    severity: healthResult.severity,
    description: `Automatic interface health alert: ${healthResult.reasons.join(" ")}`,
    technician: {
      id: technician.technicianId,
      name: technician.name,
      phone: technician.phone
    }
  });

  if (global.io) global.io.emit("incident_created", incident);

  // Keep the existing escalation workflow responsible for technician notification.
  const { processIncident } = await import("./incidentService.js");
  processIncident(incident, global.io).catch(error => {
    console.error(`[INTERFACE HEALTH] Escalation failed for ${incident.incidentId}: ${error.message}`);
  });

  return incident.incidentId;
}
