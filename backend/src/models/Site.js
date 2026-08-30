import mongoose from "mongoose";

// A Site is a physical/network location within a Realm - NOT the same
// thing as a Realm (customer/organization) or a Device (monitored asset).
// Realm > Site > Device > Interface, per the spec's own hierarchy. Devices
// reference a Site optionally (siteId is nullable on Device) so existing,
// pre-migration devices keep working unassigned rather than needing a
// forced backfill.
const siteSchema = new mongoose.Schema(
  {
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", required: true, index: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "" },
    description: { type: String, default: "" },
    timezone: { type: String, default: "UTC" }
  },
  { timestamps: true }
);

siteSchema.index({ realmId: 1, name: 1 });

export default mongoose.model("Site", siteSchema);
