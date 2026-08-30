import mongoose from "mongoose";

// A Realm is a customer/organization using NetEscalate. Every tenant-owned
// document (Device, Technician, Incident, InterfaceSample, DeviceSystemSample,
// ConfigSnapshot) carries a realmId pointing here - see migrate-to-realms.mjs
// for how existing single-tenant data was backfilled into a "Default
// Organization" realm, and authMiddleware.js's attachRealmScope for how every
// request gets scoped to exactly one realm's data.
const realmSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    industry: {
      type: String,
      enum: ["ISP", "Telecom", "Banking", "Government", "Enterprise", "Data Centre", "Education", "Healthcare", "Other"],
      default: "Other"
    },
    timezone: { type: String, default: "UTC" },
    status: { type: String, enum: ["active", "suspended", "disabled"], default: "active" },

    // Subscription/usage foundation - limits are stored but not yet enforced
    // anywhere (no billing exists). null means unlimited.
    subscriptionPlan: { type: String, enum: ["starter", "professional", "enterprise"], default: "starter" },
    maxDevices: { type: Number, default: null },
    maxUsers: { type: Number, default: null },
    maxTechnicians: { type: Number, default: null }
  },
  { timestamps: true }
);

realmSchema.index({ status: 1 });

export default mongoose.model("Realm", realmSchema);
