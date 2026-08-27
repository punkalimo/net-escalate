import Incident from "../models/Incident.js";
import Technician from "../models/Technician.js";
import { computeWeightedSeverity } from "./severityService.js";

// Shared incident lifecycle for any monitored fault condition - interface
// status, interface error-rate degradation, interface flapping, or
// device-level CPU/memory pressure. Each caller supplies its own
// fingerprint (unique per fault axis) and currentIncidentId/currentLatched
// pair, so unrelated fault axes on the same device/interface never
// interfere with each other's create/resolve decisions.
const incidentLocks = new Set();

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

export async function syncFaultIncident({
  device,
  source,
  deviceLabel,
  fingerprint,
  isRecovered,
  isFault,
  severity,
  description,
  currentIncidentId,
  currentLatched,
  interfaceName = null,
  interfaceIndex = null
}) {
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

  const lockKey = fingerprint;

  if (currentIncidentId) {
    const current = await Incident.findOne({ incidentId: currentIncidentId })
      .select("incidentId status source fingerprint")
      .lean();

    if (current && current.status !== "RESOLVED") {
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }

    // A manual RESOLVE is not a physical recovery. Keep the latch until a
    // later poll proves the condition has actually cleared.
    if (current?.status === "RESOLVED" || currentLatched) {
      return { incidentId: currentIncidentId, latch: true, recovered: false };
    }
  }

  const existing = await Incident.findOne({ source, fingerprint, status: { $ne: "RESOLVED" } }).sort({ createdAt: -1 }).lean();
  if (existing) {
    return { incidentId: existing.incidentId, latch: true, recovered: false };
  }

  if (currentLatched) {
    return { incidentId: currentIncidentId, latch: true, recovered: false };
  }

  if (incidentLocks.has(lockKey)) {
    return { incidentId: currentIncidentId, latch: true, recovered: false };
  }

  incidentLocks.add(lockKey);
  try {
    const duplicate = await Incident.findOne({ source, fingerprint, status: { $ne: "RESOLVED" } }).sort({ createdAt: -1 }).lean();
    if (duplicate) {
      return { incidentId: duplicate.incidentId, latch: true, recovered: false };
    }

    const technician = await getLevelOneTechnician();
    if (!technician?.phone) {
      console.warn(`[FAULT INCIDENT] No active level 1 technician; incident not created for ${deviceLabel}`);
      return { incidentId: currentIncidentId, latch: false, recovered: false };
    }

    const weightedSeverity = computeWeightedSeverity({ baseSeverity: severity, deviceRole: device.role, impactedDeviceCount: 0, activeMinutes: 0 });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const incidentId = await generateUniqueIncidentId();
      try {
        const incident = await Incident.create({
          incidentId,
          deviceId: device.deviceId,
          device: deviceLabel,
          location: device.location || "Unknown location",
          severity: weightedSeverity,
          description,
          technician: { id: technician.technicianId, name: technician.name, phone: technician.phone },
          source,
          fingerprint,
          interfaceName,
          interfaceIndex
        });

        if (global.io) global.io.emit("incident_created", incident);

        const { processIncident } = await import("./incidentService.js");
        processIncident(incident, global.io).catch(error => {
          console.error(`[FAULT INCIDENT] Escalation failed for ${incident.incidentId}: ${error.message}`);
        });

        return { incidentId: incident.incidentId, latch: true, recovered: false };
      } catch (createError) {
        if (createError?.code !== 11000) throw createError;
        console.warn(`[FAULT INCIDENT] Incident ID collision for ${incidentId}; retrying.`);
      }
    }

    throw new Error("Could not allocate a unique incident ID after multiple attempts.");
  } finally {
    incidentLocks.delete(lockKey);
  }
}

export default { syncFaultIncident };
