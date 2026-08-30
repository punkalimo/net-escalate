// Correlates a device configuration change with an incident on the same
// device shortly afterward - "show the change as evidence, not proof."
// Computed on demand, no new model: reads the existing ConfigSnapshot
// history (configSnapshotService.js) and the incident's own createdAt.
//
// A ConfigSnapshot's capturedAt is when the difference was DETECTED, not
// necessarily the instant the change happened - detection only happens as
// often as snapshots are taken (the periodic sweep, or a manual capture).
// The real change could have occurred any time between that snapshot and
// the previous one, so the evidence is worded as "detected at", and a
// snapshotIntervalMinutes hint is included so a caller can show that
// imprecision honestly rather than implying second-level certainty.

import ConfigSnapshot from "../models/ConfigSnapshot.js";

const DEFAULT_WINDOW_MINUTES = 60;

export function formatDuration(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export async function findPossibleChangeCause(incident, { windowMinutes = DEFAULT_WINDOW_MINUTES } = {}) {
  if (!incident?.deviceId || !incident?.createdAt) return null;

  const incidentAt = new Date(incident.createdAt);
  const windowStart = new Date(incidentAt.getTime() - windowMinutes * 60000);

  const change = await ConfigSnapshot.findOne({ realmId: incident.realmId, deviceId: incident.deviceId, changed: true, capturedAt: { $gte: windowStart, $lte: incidentAt } }).sort({ capturedAt: -1 }).lean();
  if (!change) return null;

  const priorForInterval = await ConfigSnapshot.findOne({ realmId: incident.realmId, deviceId: incident.deviceId, capturedAt: { $lt: change.capturedAt } }).sort({ capturedAt: -1 }).lean();
  const snapshotIntervalMinutes = priorForInterval ? Math.round((new Date(change.capturedAt).getTime() - new Date(priorForInterval.capturedAt).getTime()) / 60000) : null;

  const deltaSeconds = Math.round((incidentAt.getTime() - new Date(change.capturedAt).getTime()) / 1000);

  return {
    label: "Possible change-related cause",
    hostname: change.hostname,
    changeDetectedAt: change.capturedAt,
    incidentDetectedAt: incident.createdAt,
    timeDifferenceSeconds: deltaSeconds,
    timeDifferenceLabel: formatDuration(deltaSeconds),
    changes: change.changes,
    snapshotIntervalMinutes
  };
}

export default { findPossibleChangeCause, formatDuration };
