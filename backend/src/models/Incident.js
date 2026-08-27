import mongoose from "mongoose";

const escalationHistorySchema = new mongoose.Schema(
  {
    level: { type: Number, required: true },
    technicianId: { type: String, default: null },
    technicianName: { type: String, default: null },
    technicianPhone: { type: String, default: null },
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
      enum: ["ALERT_RECEIVED", "ALERT_CORRELATED", "INCIDENT_CREATED", "SEVERITY_CHANGED", "ENGINEER_ASSIGNED", "NOTIFICATION_SENT", "INCIDENT_ACKNOWLEDGED", "ENGINEER_COMMENT", "ESCALATION_TRIGGERED", "DEVICE_RECOVERY_DETECTED", "INCIDENT_RESOLVED", "INCIDENT_REOPENED", "INCIDENT_CLOSED", "MERGED", "UNMERGED"],
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

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, unique: true, required: true },
    // Stable device identity for fast "does this device have an active
    // incident" lookups. `device` below stays the human-readable label
    // (hostname, or "hostname / ifName" for interface-scoped incidents) used
    // for display and remains independently queryable for the existing
    // device-name-based UI filters.
    deviceId: { type: String, default: null },
    device: { type: String, required: true },
    location: { type: String, required: true },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    description: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "RESOLVED", "FAILED"], default: "OPEN" },
    technician: {
      id: { type: String, default: null },
      name: { type: String, default: null },
      phone: { type: String, default: null }
    },
    escalationLevel: { type: Number, default: 1 },
    calleCallId: { type: String, default: null },
    callProvider: { type: String, default: null },
    callProviderCode: { type: String, default: null },
    callProviderMessage: { type: String, default: null },
    callProviderRetryable: { type: Boolean, default: false },
    acknowledgement: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    source: { type: String, enum: ["MANUAL", "DEVICE_MONITOR", "INTERFACE_HEALTH", "SYSTEM_HEALTH"], default: "MANUAL" },
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
    timeline: { type: [timelineEventSchema], default: [] }
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

export default mongoose.model("Incident", incidentSchema);
