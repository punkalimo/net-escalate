// Time-based escalation: periodically checks every active incident against
// its severity's SLA policy (escalationPolicyService.js) and, when an
// acknowledgement or resolution deadline has passed, advances the
// escalation level and re-invokes the existing processIncident() call
// machinery - reusing its technician lookup, call, history/timeline logging
// and self-advancing loop rather than duplicating any of it.
//
// This is what actually makes escalation cancel on acknowledgement/resolve
// and keep going afterward: processIncident() alone stops the moment an
// incident is ACKNOWLEDGED and never revisits it. This sweep is what
// notices "acknowledged but still unresolved past the resolution timeout"
// and pushes it further up the chain; resolving an incident removes it from
// the query entirely, which is the cancellation.

import Incident from "../models/Incident.js";
import Realm from "../models/Realm.js";
import { computeSlaStatus } from "./escalationPolicyService.js";
import { pushTimelineEvent } from "./timelineService.js";
import { processIncident, MAX_LEVEL } from "./incidentService.js";
import { emitToRealm } from "./realtimeService.js";
import { postSystemMessage } from "./chatService.js";

const TRACKED_STATUSES = ["OPEN", "CALLING", "ESCALATING", "ACKNOWLEDGED", "FAILED"];

// Tracks by incidentId only (globally unique regardless of realm), so -
// unlike incidentCorrelationService.js's in-flight guard - this doesn't need
// to be keyed per-realm to stay tenant-safe; it just stops the same
// incident being processed twice concurrently.
const inFlight = new Set();

export async function sweepEscalationTimeouts(realmId) {
  const incidents = await Incident.find({ realmId, status: { $in: TRACKED_STATUSES } }).exec();
  let escalated = 0;

  for (const incident of incidents) {
    if (inFlight.has(incident.incidentId)) continue;
    const sla = computeSlaStatus(incident, { maxLevel: MAX_LEVEL });
    if (!sla || !sla.overdue) continue;

    inFlight.add(incident.incidentId);
    try {
      const atMaxLevel = incident.escalationLevel >= MAX_LEVEL;
      const nextLevel = atMaxLevel ? MAX_LEVEL : incident.escalationLevel + 1;
      const reason = sla.phase === "RESOLUTION"
        ? `Resolution timeout (${sla.policy.resolutionTimeoutMinutes}m) elapsed while acknowledged`
        : `Acknowledgement timeout (${sla.policy.ackTimeoutMinutes}m) elapsed at level ${incident.escalationLevel}`;
      pushTimelineEvent(incident, "ESCALATION_TRIGGERED", `${reason}; ${atMaxLevel ? "retrying" : "escalating to"} level ${nextLevel}.`, { actor: "escalation engine" });
      incident.escalationLevel = nextLevel;
      incident.status = "ESCALATING";
      await incident.save();
      if (global.io) emitToRealm(incident.realmId, "incident_updated", incident);
      postSystemMessage(incident.realmId, `⬆️ Incident ${incident.incidentId} escalated to level ${nextLevel}: ${reason}.`, { linkedIncidentId: incident.incidentId }).catch(() => {});

      await processIncident(incident, global.io);
      escalated += 1;
    } catch (error) {
      console.error(`[ESCALATION SWEEP] Failed for ${incident.incidentId}: ${error.message}`);
    } finally {
      inFlight.delete(incident.incidentId);
    }
  }

  return { checked: incidents.length, escalated };
}

async function sweepAllRealms() {
  const realms = await Realm.find({ status: "active" }).select("_id").lean();
  let checked = 0, escalated = 0;
  for (const realm of realms) {
    try {
      const result = await sweepEscalationTimeouts(realm._id);
      checked += result.checked; escalated += result.escalated;
    } catch (error) {
      console.error(`[ESCALATION SWEEP] Failed for realm ${realm._id}: ${error.message}`);
    }
  }
  return { checked, escalated };
}

let sweepTimer = null;

// A full pass can take far longer than the sweep interval: it awaits
// processIncident() (a multi-level technician call chain, several seconds
// per level) sequentially for every currently-overdue incident. Without
// this guard, setInterval would start a second full pass on top of a
// still-running first one every time the interval elapsed, then a third on
// top of that, and so on - an unbounded pile-up of concurrent passes all
// re-escalating the same overdue incidents (this is what was actually
// behind the interval-server memory leak, not a single incident's own
// timeline growth).
let sweepRunning = false;

export function startEscalationTimeoutSweep(intervalSeconds = 60) {
  stopEscalationTimeoutSweep();
  sweepTimer = setInterval(() => {
    if (sweepRunning) return;
    sweepRunning = true;
    sweepAllRealms()
      .catch(error => console.error(`[ESCALATION SWEEP] Failed: ${error.message}`))
      .finally(() => { sweepRunning = false; });
  }, intervalSeconds * 1000);
  console.log(`[ESCALATION SWEEP] Started, every ${intervalSeconds}s`);
}

export function stopEscalationTimeoutSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export default { sweepEscalationTimeouts, startEscalationTimeoutSweep, stopEscalationTimeoutSweep };
