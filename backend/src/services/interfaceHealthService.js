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

// Prevent overlapping polls from creating two incidents for the same
// device/interface/fault before either poll has finished writing to MongoDB.
const incidentLocks = new Set();

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

async function generateUniqueIncidentId() {
  // Random four-digit IDs are kept for the existing UI format, but we now
  // check MongoDB before returning one so a collision cannot abort monitoring.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const incidentId = `NET-${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await Incident.exists({ incidentId });
    if (!exists) return incidentId;
  }

  // Extremely unlikely fallback: use a timestamp-derived ID while retaining
  // the NET- prefix. The unique Mongo index remains the final protection.
  return `NET-${Date.now().toString().slice(-9)}`;
}

async function getLevelOneTechnician() {
  return Technician.findOne({ active: true, level: 1 }).sort({ createdAt: 1 }).lean();
}

function fingerprintFor(device, iface, healthResult) {
  const type = healthResult.health === "DOWN"
    ? "DOWN"
    : healthResult.health === "CRITICAL"
      ? "CRITICAL"
      : healthResult.health === "DEGRADED"
        ? "DEGRADED"
        : "WARNING";
  return `${device.deviceId}:INTERFACE_HEALTH:${Number(iface.ifIndex)}:${type}`;
}

export async function syncInterfaceIncident({ device, iface, healthResult }) {
  const interfaceMetrics = iface.metrics || {};
  const currentIncidentId = interfaceMetrics.activeIncidentId || null;
  const isHealthy = ["HEALTHY", "WARNING", "UNKNOWN"].includes(healthResult.health);
  const isFault = ["DOWN", "DEGRADED", "CRITICAL"].includes(healthResult.health);

  // Recovery is the only event that clears the interface's latch. This is
  // deliberately based on actual interface recovery, not on a technician
  // resolving the incident manually.
  if (isHealthy) {
    if (currentIncidentId) {
      const resolved = await Incident.findOneAndUpdate(
        { incidentId: currentIncidentId, status: { $ne: "RESOLVED" } },
        { status: "RESOLVED", resolvedAt: new Date() },
        { new: true }
      );
      if (resolved && global.io) global.io.emit("incident_updated", resolved);
    }
    return { incidentId: null, latch: false, recovered: Boolean(currentIncidentId) };
  }

  if (!isFault) {
    return { incidentId: currentIncidentId, latch: Boolean(currentIncidentId), recovered: false };
  }

  const fingerprint = fingerprintFor(device, iface, healthResult);
  const lockKey = `${device.deviceId}:${Number(iface.ifIndex)}:${healthResult.health}`;

  // If the monitor already has a latched incident ID, verify its state but do
  // not create another incident merely because somebody manually resolved it.
  if (currentIncidentId) {
    const current = await Incident.findOne({ incidentId: currentIncidentId }).select("incidentId status source fingerprint").lean();
    if (current && current.status !== "RESOLVED") {
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }
    // A resolved incident is intentionally still latched until the interface
    // becomes healthy. This is the behaviour required for a persistent outage.
    if (interfaceMetrics.incidentLatched === true) {
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }
  }

  // Query the database as a second line of defence. This also handles a
  // restart where the in-memory/device latch is missing.
  const existing = await Incident.findOne({
    source: "INTERFACE_HEALTH",
    fingerprint,
    status: { $ne: "RESOLVED" }
  }).sort({ createdAt: -1 }).lean();

  if (existing) {
    return { incidentId: existing.incidentId, latch: true, recovered: false };
  }

  // If the same fault has already been manually resolved, do not reopen it
  // until a real recovery has occurred. The interface monitor's latch is what
  // differentiates an ongoing outage from a new outage after recovery.
  if (interfaceMetrics.incidentLatched === true) {
    return { incidentId: currentIncidentId, latch: true, recovered: false };
  }

  if (incidentLocks.has(lockKey)) {
    return { incidentId: currentIncidentId, latch: true, recovered: false };
  }

  incidentLocks.add(lockKey);
  try {
    // Re-check after taking the lock to close the race between simultaneous polls.
    const duplicate = await Incident.findOne({
      source: "INTERFACE_HEALTH",
      fingerprint,
      status: { $ne: "RESOLVED" }
    }).sort({ createdAt: -1 }).lean();
    if (duplicate) {
      return { incidentId: duplicate.incidentId, latch: true, recovered: false };
    }

    const technician = await getLevelOneTechnician();
    if (!technician?.phone) {
      console.warn(`[INTERFACE HEALTH] No active level 1 technician; incident not created for ${device.hostname} ${iface.name}`);
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }

    const incidentId = await generateUniqueIncidentId();
    const incident = await Incident.create({
      incidentId,
      device: `${device.hostname} / ${iface.name}`,
      location: device.location || "Unknown location",
      severity: healthResult.severity,
      description: `Automatic interface health alert: ${healthResult.reasons.join(" ")}`,
      technician: {
        id: technician.technicianId,
        name: technician.name,
        phone: technician.phone
      },
      source: "INTERFACE_HEALTH",
      fingerprint,
      interfaceName: iface.name,
      interfaceIndex: Number(iface.ifIndex)
    });

    if (global.io) global.io.emit("incident_created", incident);

    const { processIncident } = await import("./incidentService.js");
    processIncident(incident, global.io).catch(error => {
      console.error(`[INTERFACE HEALTH] Escalation failed for ${incident.incidentId}: ${error.message}`);
    });

    return { incidentId: incident.incidentId, latch: true, recovered: false };
  } finally {
    incidentLocks.delete(lockKey);
  }
}
