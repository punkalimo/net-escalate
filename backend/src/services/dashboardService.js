// Aggregates the NOC dashboard's "what needs my attention right now"
// numbers in one pass over active incidents (plus a bounded recent-resolved
// window for MTTA/MTTR) - computed on demand, no new model. Reuses
// computeSlaStatus (escalationPolicyService.js) and describeFault
// (rootCauseService.js) instead of re-deriving fault/SLA logic.

import Incident from "../models/Incident.js";
import { computeSlaStatus } from "./escalationPolicyService.js";
import { describeFault } from "./rootCauseService.js";
import { MAX_LEVEL } from "./incidentService.js";

const ACTIVE_STATUSES = ["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "FAILED"];
const DEFAULT_MTTR_WINDOW_DAYS = 30;
// An incident is "approaching" its SLA deadline once less than this
// fraction of its policy window remains and it isn't overdue yet.
const APPROACHING_THRESHOLD = 0.25;

export function average(values) {
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
}

export async function computeIncidentOverview({ mttrWindowDays = DEFAULT_MTTR_WINDOW_DAYS } = {}) {
  const since = new Date(Date.now() - mttrWindowDays * 24 * 3600 * 1000);

  const [active, recentResolved] = await Promise.all([
    Incident.find({ status: { $in: ACTIVE_STATUSES } }).lean(),
    Incident.find({ status: "RESOLVED", resolvedAt: { $gte: since } }).lean()
  ]);

  const critical = active.filter(incident => incident.severity === "critical");
  const unacknowledged = active.filter(incident => incident.status !== "ACKNOWLEDGED");
  const escalated = active.filter(incident => incident.escalationLevel > 1);

  let slaBreaches = 0;
  let approachingSlaBreach = 0;
  for (const incident of active) {
    const sla = computeSlaStatus(incident, { maxLevel: MAX_LEVEL });
    if (!sla) continue;
    const windowMinutes = sla.policy[sla.phase === "RESOLUTION" ? "resolutionTimeoutMinutes" : "ackTimeoutMinutes"];
    if (sla.overdue) slaBreaches += 1;
    else if (sla.minutesRemaining <= windowMinutes * APPROACHING_THRESHOLD) approachingSlaBreach += 1;
  }

  const devicesAffected = new Set(active.map(incident => incident.deviceId || incident.device).filter(Boolean)).size;

  const siteCounts = new Map();
  for (const incident of active) {
    if (!incident.location) continue;
    siteCounts.set(incident.location, (siteCounts.get(incident.location) || 0) + 1);
  }
  const topSites = [...siteCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([site, count]) => ({ site, count }));

  const rootCauseCounts = new Map();
  for (const incident of active) {
    const kind = describeFault(incident).kind;
    rootCauseCounts.set(kind, (rootCauseCounts.get(kind) || 0) + 1);
  }
  const topRootCauses = [...rootCauseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cause, count]) => ({ cause, count }));

  // MTTA draws from both currently-active-or-later incidents and recently
  // resolved ones, so it isn't skewed toward only fast-closing incidents.
  const ackDurationsMinutes = [];
  for (const incident of [...active, ...recentResolved]) {
    const ackEntry = (incident.escalationHistory || []).find(entry => entry.status === "ACKNOWLEDGED");
    if (ackEntry?.completedAt) ackDurationsMinutes.push((new Date(ackEntry.completedAt).getTime() - new Date(incident.createdAt).getTime()) / 60000);
  }

  const resolveDurationsMinutes = recentResolved.filter(incident => incident.resolvedAt).map(incident => (new Date(incident.resolvedAt).getTime() - new Date(incident.createdAt).getTime()) / 60000);

  return {
    generatedAt: new Date().toISOString(),
    activeIncidents: active.length,
    criticalIncidents: critical.length,
    unacknowledgedIncidents: unacknowledged.length,
    slaBreaches,
    approachingSlaBreach,
    escalatedIncidents: escalated.length,
    devicesAffected,
    topSites,
    topRootCauses,
    meanTimeToAcknowledgeMinutes: average(ackDurationsMinutes),
    meanTimeToResolveMinutes: average(resolveDurationsMinutes),
    mttrWindowDays,
    mttrSampleSize: recentResolved.length
  };
}

export default { computeIncidentOverview, average };
