// Every incident maintains a persistent, chronological event log -
// embedded on the Incident document itself (same pattern as the existing
// escalationHistory/correlationEvidence arrays), not a separate collection,
// since a single incident's lifetime event count is small and bounded.
// escalationHistory stays the detailed record of technician call attempts;
// timeline is the broader audit trail spec's Phase 4 asks for (alerts,
// correlation, severity changes, comments, resolution...).

export const TIMELINE_EVENT_TYPES = [
  "ALERT_RECEIVED",
  "ALERT_CORRELATED",
  "INCIDENT_CREATED",
  "SEVERITY_CHANGED",
  "ENGINEER_ASSIGNED",
  "NOTIFICATION_SENT",
  "INCIDENT_ACKNOWLEDGED",
  "ENGINEER_COMMENT",
  "ESCALATION_TRIGGERED",
  "DEVICE_RECOVERY_DETECTED",
  "INCIDENT_RESOLVED",
  "INCIDENT_REOPENED",
  "INCIDENT_CLOSED",
  "MERGED",
  "UNMERGED"
];

export function buildTimelineEvent(type, message, { actor = "system", metadata = null } = {}) {
  return { type, message, actor, metadata, at: new Date() };
}

// Mutates a loaded Mongoose Incident document in place; the caller still
// calls .save(). For a findOneAndUpdate/$push call site, use
// buildTimelineEvent directly instead.
export function pushTimelineEvent(incident, type, message, options = {}) {
  if (!incident.timeline) incident.timeline = [];
  incident.timeline.push(buildTimelineEvent(type, message, options));
  return incident;
}

export default { TIMELINE_EVENT_TYPES, buildTimelineEvent, pushTimelineEvent };
