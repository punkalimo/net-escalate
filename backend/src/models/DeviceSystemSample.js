import mongoose from "mongoose";

// Time-series history for device-level CPU/memory readings, mirroring
// InterfaceSample: Device.systemHealth holds only the current snapshot,
// trending/graphing needs the per-poll history kept separately so the
// embedded document doesn't grow unbounded.
const deviceSystemSampleSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", required: true, index: true },
    hostname: { type: String, default: "" },
    metric: { type: String, enum: ["cpu", "memory"], required: true },
    utilizationPercent: { type: Number, default: null },
    health: { type: String, enum: ["HEALTHY", "WARNING", "DEGRADED", "CRITICAL", "UNKNOWN"], default: "UNKNOWN" },
    sampledAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

deviceSystemSampleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
deviceSystemSampleSchema.index({ deviceId: 1, metric: 1, sampledAt: -1 });
deviceSystemSampleSchema.index({ realmId: 1, deviceId: 1, metric: 1, sampledAt: -1 });

const DeviceSystemSample = mongoose.models.DeviceSystemSample || mongoose.model("DeviceSystemSample", deviceSystemSampleSchema);
export default DeviceSystemSample;
