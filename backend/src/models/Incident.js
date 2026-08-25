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

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, unique: true, required: true },
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
    source: { type: String, enum: ["MANUAL", "DEVICE_MONITOR", "INTERFACE_HEALTH"], default: "MANUAL" },
    fingerprint: { type: String, default: null, index: true },
    interfaceName: { type: String, default: null },
    interfaceIndex: { type: Number, default: null },
    correlationGroupId: { type: String, default: null, index: true },
    correlationRole: { type: String, enum: ["ROOT", "CHILD", "STANDALONE"], default: "STANDALONE" },
    parentIncidentId: { type: String, default: null, index: true },
    correlationConfidence: { type: Number, default: null, min: 0, max: 100 },
    correlationEvidence: { type: [String], default: [] },
    escalationHistory: { type: [escalationHistorySchema], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model("Incident", incidentSchema);
