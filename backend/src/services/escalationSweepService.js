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
import { computeSlaStatus } from "./escalationPolicyService.js";
import { pushTimelineEvent } from "./timelineService.js";
import { processIncident, MAX_LEVEL } from "./incidentService.js";

const TRACKED_STATUSES = ["OPEN", "CALLING", "ESCALATING", "ACKNOWLEDGED", "FAILED"];

const inFlight = new Set();

export async function sweepEscalationTimeouts() {
  const incidents = await Incident.find({ status: { $in: TRACKED_STATUSES } }).exec();
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
      if (global.io) global.io.emit("incident_updated", incident);

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
    sweepEscalationTimeouts()
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
