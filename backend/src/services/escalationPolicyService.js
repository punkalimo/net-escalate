// Severity-based escalation policy: how long an incident may sit
// unacknowledged at its current level, and how long it may sit acknowledged
// but unresolved, before the escalation engine automatically advances it.
// Deliberately a plain in-memory table rather than a new DB-backed model -
// nothing in this codebase manages escalation policy today, and this keeps
// the numbers easy to read/tune without introducing CRUD/UI surface no one
// asked for. computeSlaStatus is pure and reuses only fields the Incident
// model already has (status, severity, escalationLevel, escalationHistory,
// createdAt) - no new persisted fields.

const DEFAULT_POLICY = {
  critical: { ackTimeoutMinutes: 5, resolutionTimeoutMinutes: 15 },
  high: { ackTimeoutMinutes: 10, resolutionTimeoutMinutes: 30 },
  medium: { ackTimeoutMinutes: 20, resolutionTimeoutMinutes: 60 },
  low: { ackTimeoutMinutes: 30, resolutionTimeoutMinutes: 120 }
};

export function getEscalationPolicy(severity) {
  return DEFAULT_POLICY[severity] || DEFAULT_POLICY.medium;
}

// Returns null when there is nothing to count down to: the incident is
// resolved, or it has no escalation activity yet to measure from.
export function computeSlaStatus(incident, { now = Date.now(), maxLevel = 3 } = {}) {
  if (!incident || incident.status === "RESOLVED") return null;
  const policy = getEscalationPolicy(incident.severity);
  const history = incident.escalationHistory || [];

  if (incident.status === "ACKNOWLEDGED") {
    const ackEntry = [...history].reverse().find(entry => entry.status === "ACKNOWLEDGED");
    const ackAt = ackEntry?.completedAt ? new Date(ackEntry.completedAt).getTime() : null;
    if (!ackAt) return null;
    const deadline = ackAt + policy.resolutionTimeoutMinutes * 60000;
    return {
      phase: "RESOLUTION",
      nextLevel: Math.min(incident.escalationLevel + 1, maxLevel),
      deadline: new Date(deadline).toISOString(),
      minutesRemaining: Math.max(0, Math.round((deadline - now) / 60000)),
      overdue: now > deadline,
      policy
    };
  }

  if (["OPEN", "CALLING", "ESCALATING", "FAILED"].includes(incident.status)) {
    const latest = history[history.length - 1];
    const basis = latest?.startedAt ? new Date(latest.startedAt).getTime() : new Date(incident.createdAt).getTime();
    const deadline = basis + policy.ackTimeoutMinutes * 60000;
    return {
      phase: "ACKNOWLEDGEMENT",
      nextLevel: Math.min(incident.escalationLevel + 1, maxLevel),
      deadline: new Date(deadline).toISOString(),
      minutesRemaining: Math.max(0, Math.round((deadline - now) / 60000)),
      overdue: now > deadline,
      policy
    };
  }

  return null;
}

export default { getEscalationPolicy, computeSlaStatus };
