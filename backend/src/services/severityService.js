import Incident from "../models/Incident.js";
import Device from "../models/Device.js";
import { buildTimelineEvent } from "./timelineService.js";

const ACTIVE_INCIDENT_STATUSES = ["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "FAILED"];

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const RANK_SEVERITY = ["low", "medium", "high", "critical"];

const DEFAULT_ESCALATION_MINUTES = 5;

function rankOf(severity) {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.medium;
}

// Combines three factors into a final severity. Deliberately monotonic
// (each factor can only raise the rank via Math.max, never lower it) so
// severity for an active incident only ever escalates, never flaps back
// down mid-incident - it settles back to whatever the fault itself implies
// only once the incident is resolved and a fresh one is created.
//
// - deviceRole: a fault on a core device is floored at "high" even if the
//   fault type alone would only be "medium" - the same fault matters more
//   the closer to the core it is. Edge gets a smaller floor; access/host
//   are not floored at all (the fault's own severity stands).
// - impactedDeviceCount: a fault currently taking other devices down with
//   it (see the topology-suppression/impactedDevices work) is worse than
//   the same fault in isolation, regardless of role.
// - activeMinutes: anything left open past the configurable escalation
//   window and not already critical is promoted - an ignored fault is
//   worse than the same fault five minutes in.
export function computeWeightedSeverity({ baseSeverity, deviceRole, impactedDeviceCount = 0, activeMinutes = 0, escalationMinutes = DEFAULT_ESCALATION_MINUTES }) {
  let rank = rankOf(baseSeverity);

  if (deviceRole === "core") rank = Math.max(rank, SEVERITY_RANK.high);
  else if (deviceRole === "edge") rank = Math.max(rank, SEVERITY_RANK.medium);

  if (impactedDeviceCount >= 5) rank = Math.max(rank, SEVERITY_RANK.critical);
  else if (impactedDeviceCount >= 1) rank = Math.max(rank, SEVERITY_RANK.high);

  if (activeMinutes >= escalationMinutes) rank = Math.max(rank, SEVERITY_RANK.critical);

  return RANK_SEVERITY[Math.min(rank, SEVERITY_RANK.critical)];
}

let sweepTimer = null;

// Periodically re-weights every active incident's severity. Needed because
// two of the three inputs change without a new poll event necessarily
// touching that specific incident: impactedDeviceCount can grow as other
// devices attach to an already-open incident, and activeMinutes advances
// purely with wall-clock time.
export async function sweepActiveIncidentSeverity() {
  const incidents = await Incident.find({ status: { $in: ACTIVE_INCIDENT_STATUSES } })
    .select("incidentId deviceId severity impactedDevices createdAt correlationGroupId correlationRole")
    .lean();

  if (!incidents.length) return { checked: 0, updated: 0 };

  const deviceIds = [...new Set(incidents.map(incident => incident.deviceId).filter(Boolean))];
  const devices = await Device.find({ deviceId: { $in: deviceIds } }).select("deviceId role alertThresholds.severityEscalationMinutes").lean();
  const deviceById = new Map(devices.map(device => [device.deviceId, device]));

  // A root incident's correlated children count toward its blast radius too,
  // not just its own impactedDevices - built from the same already-loaded
  // query, no extra round trip.
  const childCountByGroup = new Map();
  for (const incident of incidents) {
    if (incident.correlationRole === "CHILD" && incident.correlationGroupId) {
      childCountByGroup.set(incident.correlationGroupId, (childCountByGroup.get(incident.correlationGroupId) || 0) + 1);
    }
  }

  const now = Date.now();
  let updated = 0;

  for (const incident of incidents) {
    const device = incident.deviceId ? deviceById.get(incident.deviceId) : null;
    const escalationMinutes = Number(device?.alertThresholds?.severityEscalationMinutes) || DEFAULT_ESCALATION_MINUTES;
    const activeMinutes = (now - new Date(incident.createdAt).getTime()) / 60000;
    const correlatedChildren = incident.correlationRole === "ROOT" && incident.correlationGroupId ? (childCountByGroup.get(incident.correlationGroupId) || 0) : 0;

    const nextSeverity = computeWeightedSeverity({
      baseSeverity: incident.severity,
      deviceRole: device?.role,
      impactedDeviceCount: (incident.impactedDevices?.length || 0) + correlatedChildren,
      activeMinutes,
      escalationMinutes
    });

    if (nextSeverity === incident.severity) continue;

    const result = await Incident.findOneAndUpdate(
      { incidentId: incident.incidentId, status: { $in: ACTIVE_INCIDENT_STATUSES } },
      { $set: { severity: nextSeverity }, $push: { timeline: buildTimelineEvent("SEVERITY_CHANGED", `Severity escalated from ${incident.severity} to ${nextSeverity}.`, { actor: "severity engine" }) } },
      { new: true }
    );

    if (result) {
      updated += 1;
      if (global.io) global.io.emit("incident_updated", result);
    }
  }

  return { checked: incidents.length, updated };
}

export function startSeverityEscalationSweep(intervalSeconds = 60) {
  stopSeverityEscalationSweep();
  sweepTimer = setInterval(() => {
    sweepActiveIncidentSeverity().catch(error => console.error(`[SEVERITY SWEEP] Failed: ${error.message}`));
  }, intervalSeconds * 1000);
  console.log(`[SEVERITY SWEEP] Started, every ${intervalSeconds}s`);
}

export function stopSeverityEscalationSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export default { computeWeightedSeverity, sweepActiveIncidentSeverity, startSeverityEscalationSweep, stopSeverityEscalationSweep };
