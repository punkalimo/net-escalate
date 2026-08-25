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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const incidentId = `NET-${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await Incident.exists({ incidentId });
    if (!exists) return incidentId;
  }
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
  // UNKNOWN means we cannot prove recovery. Only a confirmed HEALTHY poll
  // is allowed to release an outage latch.
  const isRecovered = healthResult.health === "HEALTHY";
  const isFault = ["DOWN", "DEGRADED", "CRITICAL"].includes(healthResult.health);

  if (isRecovered) {
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

  if (currentIncidentId) {
    const current = await Incident.findOne({ incidentId: currentIncidentId })
      .select("incidentId status source fingerprint")
      .lean();

    if (current && current.status !== "RESOLVED") {
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }

    // A manual RESOLVE is not a physical recovery. Keep the latch until a
    // later SNMP poll proves the interface is HEALTHY.
    if (current?.status === "RESOLVED" || interfaceMetrics.incidentLatched === true) {
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }
  }

  const existing = await Incident.findOne({
    source: "INTERFACE_HEALTH",
    fingerprint,
    status: { $ne: "RESOLVED" }
  }).sort({ createdAt: -1 }).lean();

  if (existing) {
    return { incidentId: existing.incidentId, latch: true, recovered: false };
  }

  if (interfaceMetrics.incidentLatched === true) {
    return { incidentId: currentIncidentId, latch: true, recovered: false };
  }

  if (incidentLocks.has(lockKey)) {
    return { incidentId: currentIncidentId, latch: true, recovered: false };
  }

  incidentLocks.add(lockKey);
  try {
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
      return { incidentId: currentIncidentId, latch: false, recovered: false };
    }

    const severity = healthResult.severity;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const incidentId = await generateUniqueIncidentId();
      try {
        const incident = await Incident.create({
          incidentId,
          device: `${device.hostname} / ${iface.name}`,
          location: device.location || "Unknown location",
          severity,
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
      } catch (createError) {
        if (createError?.code !== 11000) throw createError;
        console.warn(`[INTERFACE HEALTH] Incident ID collision for ${incidentId}; retrying.`);
      }
    }

    throw new Error("Could not allocate a unique incident ID after multiple attempts.");
  } finally {
    incidentLocks.delete(lockKey);
  }
}
