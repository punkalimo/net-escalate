import mongoose from "mongoose";

const configSnapshotSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    hostname: { type: String, default: "" },
    source: { type: String, enum: ["SNMP", "DEVICE", "MANUAL"], default: "DEVICE" },
    fingerprint: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    changed: { type: Boolean, default: false },
    changes: { type: [String], default: [] },
    capturedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

configSnapshotSchema.index({ deviceId: 1, capturedAt: -1 });
configSnapshotSchema.index({ deviceId: 1, fingerprint: 1 });

export default mongoose.models.ConfigSnapshot || mongoose.model("ConfigSnapshot", configSnapshotSchema);
