import mongoose from "mongoose";

const escalationHistorySchema = new mongoose.Schema(
  {
    level: { type: Number, required: true },
    technicianId: { type: String, default: null },
    technicianName: { type: String, default: null },
    technicianPhone: { type: String, default: null },
    technicianRole: { type: String, default: null },
    callId: { type: String, default: null },
    provider: { type: String, default: null },
    providerCode: { type: String, default: null },
    providerStatus: { type: Number, default: null },
    retryable: { type: Boolean, default: false },
    status: { type: String, enum: ["CALLING", "ACKNOWLEDGED", "DECLINED", "NO_ANSWER", "FAILED", "ESCALATED", "PROVIDER_UNAVAILABLE"], default: "CALLING" },
    response: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
  },
  { _id: false }
);

const timelineEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["ALERT_RECEIVED", "ALERT_CORRELATED", "INCIDENT_CREATED", "SEVERITY_CHANGED", "ENGINEER_ASSIGNED", "NOTIFICATION_SENT", "INCIDENT_ACKNOWLEDGED", "ENGINEER_COMMENT", "ESCALATION_TRIGGERED", "DEVICE_RECOVERY_DETECTED", "INCIDENT_RESOLVED", "INCIDENT_REOPENED", "INCIDENT_CLOSED", "MERGED", "UNMERGED", "REMEDIATION_PROPOSED", "REMEDIATION_APPROVED", "REMEDIATION_REJECTED", "REMEDIATION_STARTED", "REMEDIATION_SUCCEEDED", "REMEDIATION_FAILED"],
      required: true
    },
    message: { type: String, required: true },
    actor: { type: String, default: "system" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const impactedDeviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    hostname: { type: String, required: true },
    status: { type: String, default: null },
    attachedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// A proposed remediation always passes through this exact sequence -
// PROPOSED -> APPROVED -> RUNNING -> SUCCEEDED/FAILED, or PROPOSED ->
// REJECTED. Nothing transitions to RUNNING without an explicit approval
// step first; see remediationService.js for why execution itself is only
// ever simulated, never a real device command.
const remediationActionSchema = new mongoose.Schema(
  {
    actionId: { type: String, required: true },
    actionType: { type: String, required: true },
    label: { type: String, required: true },
    riskLevel: { type: String, enum: ["low", "medium", "high"], default: "low" },
    status: { type: String, enum: ["PROPOSED", "APPROVED", "REJECTED", "RUNNING", "SUCCEEDED", "FAILED"], default: "PROPOSED" },
    proposedBy: { type: String, default: "system" },
    decidedBy: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    result: { type: String, default: null },
    proposedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, unique: true, required: true },
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", required: true, index: true },
    // Stable device identity for fast "does this device have an active
    // incident" lookups. `device` below stays the human-readable label
    // (hostname, or "hostname / ifName" for interface-scoped incidents) used
    // for display and remains independently queryable for the existing
    // device-name-based UI filters.
    deviceId: { type: String, default: null },
    device: { type: String, required: true },
    location: { type: String, required: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    // Human-readable factors behind the current severity - "do not blindly
    // change severity without clear reasoning," per the spec. Set whenever
    // severity is computed (creation and the severity sweep), not only when
    // it changes, so every incident always has an explanation to show.
    severityReasons: { type: [String], default: [] },
    description: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "RESOLVED", "FAILED"], default: "OPEN" },
    technician: {
      id: { type: String, default: null },
      name: { type: String, default: null },
      phone: { type: String, default: null },
      // The technician's own role at assignment time (e.g. "Network
      // Engineer") - the closest honest equivalent this system has to the
      // spec's "assigned team", since technicians aren't otherwise grouped
      // into named teams.
      role: { type: String, default: null }
    },
    escalationLevel: { type: Number, default: 1 },
    calleCallId: { type: String, default: null },
    callProvider: { type: String, default: null },
    callProviderCode: { type: String, default: null },
    callProviderMessage: { type: String, default: null },
    callProviderRetryable: { type: Boolean, default: false },
    acknowledgement: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    // What a NOC engineer actually did to fix it, entered optionally when
    // manually resolving. This is the only source of "previous resolution"
    // text for historical-incident matching - automatic incidents self-
    // resolve on recovery with no human diagnosis to record.
    resolutionNotes: { type: String, default: null },
    // "AGENT" = created through a WebMCP tool after explicit human approval
    // in the UI (see webmcpRoutes.js/create_incident) - kept distinct from
    // "MANUAL" purely so the dashboard/timeline can visibly attribute it,
    // not because it behaves differently: it's still a human-approved,
    // manually-resolvable incident, same as MANUAL (see the RESOLVE route's
    // ["DEVICE_MONITOR","INTERFACE_HEALTH"] check below, which AGENT never matches).
    source: { type: String, enum: ["MANUAL", "AGENT", "DEVICE_MONITOR", "INTERFACE_HEALTH", "SYSTEM_HEALTH"], default: "MANUAL" },
    fingerprint: { type: String, default: null, index: true },
    interfaceName: { type: String, default: null },
    interfaceIndex: { type: Number, default: null },
    correlationGroupId: { type: String, default: null, index: true },
    correlationRole: { type: String, enum: ["ROOT", "CHILD", "STANDALONE"], default: "STANDALONE" },
    parentIncidentId: { type: String, default: null, index: true },
    correlationConfidence: { type: Number, default: null, min: 0, max: 100 },
    correlationEvidence: { type: [String], default: [] },
    // Set by the manual merge/unmerge endpoints. While true, the automatic
    // correlation sweep leaves this incident's grouping untouched entirely -
    // a NOC engineer's explicit call overrides the topology heuristics until
    // they explicitly merge/unmerge again (or the incident resolves).
    correlationManual: { type: Boolean, default: false },
    escalationHistory: { type: [escalationHistorySchema], default: [] },
    impactedDevices: { type: [impactedDeviceSchema], default: [] },
    timeline: { type: [timelineEventSchema], default: [] },
    remediationActions: { type: [remediationActionSchema], default: [] }
  },
  { timestamps: true }
);

// Explicit single-field indexes for status and deviceId: the hot-path query
// across device/interface monitoring is "does this device currently have an
// active incident" (deviceId + status), run on every poll cycle for every
// device, so it needs to stay fast as incident history grows regardless of
// which other filters (severity, source, correlation) a given query adds.
incidentSchema.index({ status: 1 });
incidentSchema.index({ deviceId: 1 });
incidentSchema.index({ deviceId: 1, status: 1 });
incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ status: 1, severity: 1, createdAt: -1 });
incidentSchema.index({ device: 1, status: 1, createdAt: -1 });
incidentSchema.index({ source: 1, status: 1, createdAt: -1 });
incidentSchema.index({ correlationGroupId: 1, correlationRole: 1 });

// realmId-qualified equivalents of the hot-path indexes above - every route
// and sweep now filters by realmId first, so these are what actually serve
// those queries going forward; the un-prefixed indexes above are left in
// place rather than dropped (harmless, and any not-yet-migrated code path
// still benefits from them).
incidentSchema.index({ realmId: 1, status: 1 });
incidentSchema.index({ realmId: 1, deviceId: 1, status: 1 });
incidentSchema.index({ realmId: 1, status: 1, createdAt: -1 });
incidentSchema.index({ realmId: 1, status: 1, severity: 1, createdAt: -1 });

export default mongoose.model("Incident", incidentSchema);
