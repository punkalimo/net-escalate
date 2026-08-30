import mongoose from "mongoose";

const interfaceSampleSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", required: true, index: true },
    hostname: { type: String, default: "" },
    ifIndex: { type: Number, required: true, index: true },
    interfaceName: { type: String, required: true },
    status: { type: String, enum: ["UP", "DOWN", "UNKNOWN"], default: "UNKNOWN" },
    speedMbps: { type: Number, default: null },
    inBps: { type: Number, default: null },
    outBps: { type: Number, default: null },
    utilizationPercent: { type: Number, default: null },
    inErrors: { type: Number, default: 0 },
    outErrors: { type: Number, default: 0 },
    inDiscards: { type: Number, default: 0 },
    outDiscards: { type: Number, default: 0 },
    // Precomputed rates (per minute), same reasoning as inBps/outBps being
    // precomputed rather than making every reader re-derive deltas from
    // raw cumulative counters across samples.
    errorRatePerMin: { type: Number, default: null },
    discardRatePerMin: { type: Number, default: null },
    duplex: { type: String, default: "UNKNOWN" },
    health: { type: String, enum: ["HEALTHY", "WARNING", "DEGRADED", "CRITICAL", "DOWN", "ADMIN_DOWN", "UNMONITORED", "UNKNOWN"], default: "UNKNOWN" },
    healthScore: { type: Number, default: null },
    sampledAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

interfaceSampleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
interfaceSampleSchema.index({ deviceId: 1, ifIndex: 1, sampledAt: -1 });
interfaceSampleSchema.index({ realmId: 1, deviceId: 1, ifIndex: 1, sampledAt: -1 });

const InterfaceSample = mongoose.models.InterfaceSample || mongoose.model("InterfaceSample", interfaceSampleSchema);
export default InterfaceSample;
