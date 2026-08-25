import mongoose from "mongoose";

const escalationHistorySchema = new mongoose.Schema(
  {
    level: { type: Number, required: true },
    technicianId: { type: String, default: null },
    technicianName: { type: String, default: null },
    technicianPhone: { type: String, default: null },
    callId: { type: String, default: null },
    status: {
      type: String,
      enum: ["CALLING", "ACKNOWLEDGED", "DECLINED", "NO_ANSWER", "FAILED", "ESCALATED"],
      default: "CALLING"
    },
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
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    description: { type: String, required: true },
    status: {
      type: String,
      enum: ["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "RESOLVED", "FAILED"],
      default: "OPEN"
    },
    technician: {
      id: { type: String, default: null },
      name: { type: String, default: null },
      phone: { type: String, default: null }
    },
    escalationLevel: { type: Number, default: 1 },
    calleCallId: { type: String, default: null },
    acknowledgement: { type: String, default: null },
    resolvedAt: { type: Date, default: null },

    // Correlation fields used by automatic interface-health incidents.
    // A resolved interface incident must not immediately reopen while the
    // same physical fault is still present. The interface monitor owns the
    // recovery transition and clears its latch when the interface recovers.
    source: {
      type: String,
      enum: ["MANUAL", "DEVICE_MONITOR", "INTERFACE_HEALTH"],
      default: "MANUAL"
    },
    fingerprint: { type: String, default: null, index: true },
    interfaceName: { type: String, default: null },
    interfaceIndex: { type: Number, default: null },

    escalationHistory: { type: [escalationHistorySchema], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model("Incident", incidentSchema);
