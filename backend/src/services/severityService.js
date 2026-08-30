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

// Combines several factors into a final severity, and explains itself while
// doing it - "do not blindly change severity without clear reasoning."
// Deliberately monotonic (each factor can only raise the rank, never lower
// it) so severity for an active incident only ever escalates, never flaps
// back down mid-incident - it settles back to whatever the fault itself
// implies only once the incident is resolved and a fresh one is created.
//
// - deviceRole: a fault on a core device is floored at "high" even if the
//   fault type alone would only be "medium" - the same fault matters more
//   the closer to the core it is. Edge gets a smaller floor; access/host
//   are not floored at all (the fault's own severity stands).
// - impactedDeviceCount: a fault currently taking other devices down with
//   it (topology suppression + correlation-group children) is worse than
//   the same fault in isolation, regardless of role.
// - sitesAffected: a fault reaching a second site is a materially bigger
//   incident than the same blast radius confined to one site.
// - affectedInterfaceCount: noted in the reasoning for completeness (the
//   spec's own "number of affected interfaces" factor); it does not floor
//   severity on its own today - device/site counts are the dominant signal
//   and interface count mostly tracks device count already.
// - activeMinutes: anything left open past the configurable escalation
//   window and not already critical is promoted - an ignored fault is
//   worse than the same fault five minutes in.
export function computeSeverityWithReasons({ baseSeverity, deviceRole, impactedDeviceCount = 0, activeMinutes = 0, escalationMinutes = DEFAULT_ESCALATION_MINUTES, sitesAffected = 0, affectedInterfaceCount = 0 }) {
  let rank = rankOf(baseSeverity);
  const reasons = [`Base severity from the detected fault: ${baseSeverity}.`];

  if (deviceRole === "core" && rank < SEVERITY_RANK.high) { rank = SEVERITY_RANK.high; reasons.push("Root device role is core - floored at high."); }
  else if (deviceRole === "edge" && rank < SEVERITY_RANK.medium) { rank = SEVERITY_RANK.medium; reasons.push("Root device role is edge - floored at medium."); }

  if (impactedDeviceCount >= 5 && rank < SEVERITY_RANK.critical) { rank = SEVERITY_RANK.critical; reasons.push(`${impactedDeviceCount} downstream devices affected - floored at critical.`); }
  else if (impactedDeviceCount >= 1 && rank < SEVERITY_RANK.high) { rank = SEVERITY_RANK.high; reasons.push(`${impactedDeviceCount} downstream device(s) affected - floored at high.`); }
  else if (impactedDeviceCount >= 1) { reasons.push(`${impactedDeviceCount} downstream device(s) affected.`); }

  if (sitesAffected >= 2 && rank < SEVERITY_RANK.critical) { rank = SEVERITY_RANK.critical; reasons.push(`${sitesAffected} sites impacted - floored at critical.`); }
  else if (sitesAffected >= 2) { reasons.push(`${sitesAffected} sites impacted.`); }

  if (affectedInterfaceCount >= 1) reasons.push(`${affectedInterfaceCount} interface(s) affected.`);

  if (activeMinutes >= escalationMinutes && rank < SEVERITY_RANK.critical) { rank = SEVERITY_RANK.critical; reasons.push(`Active for ${Math.round(activeMinutes)}m, past the ${escalationMinutes}m escalation window - auto-promoted to critical.`); }

  rank = Math.min(rank, SEVERITY_RANK.critical);
  return { severity: RANK_SEVERITY[rank], reasons };
}

// Backward-compatible plain-string form for call sites that only need the
// resulting severity, not the explanation.
export function computeWeightedSeverity(input) {
  return computeSeverityWithReasons(input).severity;
}

let sweepTimer = null;

// Periodically re-weights every active incident's severity. Needed because
// two of the three inputs change without a new poll event necessarily
// touching that specific incident: impactedDeviceCount can grow as other
// devices attach to an already-open incident, and activeMinutes advances
// purely with wall-clock time.
export async function sweepActiveIncidentSeverity() {
  const incidents = await Incident.find({ status: { $in: ACTIVE_INCIDENT_STATUSES } })
    .select("incidentId deviceId severity impactedDevices createdAt correlationGroupId correlationRole interfaceName")
    .lean();

  if (!incidents.length) return { checked: 0, updated: 0 };

  const deviceIds = [...new Set(incidents.map(incident => incident.deviceId).filter(Boolean))];
  const devices = await Device.find({ deviceId: { $in: deviceIds } }).select("deviceId role location alertThresholds.severityEscalationMinutes").lean();
  const deviceById = new Map(devices.map(device => [device.deviceId, device]));

  // A root incident's correlated children count toward its blast radius too,
  // not just its own impactedDevices - built from the same already-loaded
  // incidents/devices queries, no extra round trip. Every active incident's
  // own device is already resolvable via deviceById, children included.
  const childrenByGroup = new Map();
  for (const incident of incidents) {
    if (incident.correlationRole === "CHILD" && incident.correlationGroupId) {
      if (!childrenByGroup.has(incident.correlationGroupId)) childrenByGroup.set(incident.correlationGroupId, []);
      childrenByGroup.get(incident.correlationGroupId).push(incident);
    }
  }

  const now = Date.now();
  let updated = 0;

  for (const incident of incidents) {
    const device = incident.deviceId ? deviceById.get(incident.deviceId) : null;
    const escalationMinutes = Number(device?.alertThresholds?.severityEscalationMinutes) || DEFAULT_ESCALATION_MINUTES;
    const activeMinutes = (now - new Date(incident.createdAt).getTime()) / 60000;
    const children = incident.correlationRole === "ROOT" && incident.correlationGroupId ? (childrenByGroup.get(incident.correlationGroupId) || []) : [];

    const sitesAffected = new Set([device?.location, ...children.map(child => (child.deviceId ? deviceById.get(child.deviceId)?.location : null))].filter(Boolean)).size;
    const affectedInterfaceCount = new Set([incident.interfaceName, ...children.map(child => child.interfaceName)].filter(Boolean)).size;

    const { severity: nextSeverity, reasons } = computeSeverityWithReasons({
      baseSeverity: incident.severity,
      deviceRole: device?.role,
      impactedDeviceCount: (incident.impactedDevices?.length || 0) + children.length,
      activeMinutes,
      escalationMinutes,
      sitesAffected,
      affectedInterfaceCount
    });

    if (nextSeverity === incident.severity) continue;

    const result = await Incident.findOneAndUpdate(
      { incidentId: incident.incidentId, status: { $in: ACTIVE_INCIDENT_STATUSES } },
      { $set: { severity: nextSeverity, severityReasons: reasons }, $push: { timeline: buildTimelineEvent("SEVERITY_CHANGED", `Severity escalated from ${incident.severity} to ${nextSeverity}. ${reasons[reasons.length - 1]}`, { actor: "severity engine" }) } },
      { new: true }
    );

    if (result) {
      updated += 1;
      if (global.io) global.io.emit("incident_updated", result);
    }
  }

  return { checked: incidents.length, updated };
}

// Same overlap guard as escalationSweepService.js: skip a tick entirely if
// the previous one is still running, rather than letting setInterval stack
// a new pass on top of it as the active-incident count grows.
let sweepRunning = false;

export function startSeverityEscalationSweep(intervalSeconds = 60) {
  stopSeverityEscalationSweep();
  sweepTimer = setInterval(() => {
    if (sweepRunning) return;
    sweepRunning = true;
    sweepActiveIncidentSeverity()
      .catch(error => console.error(`[SEVERITY SWEEP] Failed: ${error.message}`))
      .finally(() => { sweepRunning = false; });
  }, intervalSeconds * 1000);
  console.log(`[SEVERITY SWEEP] Started, every ${intervalSeconds}s`);
}

export function stopSeverityEscalationSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export default { computeWeightedSeverity, computeSeverityWithReasons, sweepActiveIncidentSeverity, startSeverityEscalationSweep, stopSeverityEscalationSweep };
