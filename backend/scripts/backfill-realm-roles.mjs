// One-time (but safely re-runnable) backfill: authorization is switching
// from Technician.level (an escalation-tier field) to the separate realmRole
// field for account-management permissions (edit/deactivate/reset-
// credentials/view performance - see requireRealmManager in
// authMiddleware.js). realmRole has never been set by any route or UI until
// now, so every existing technician - including every realm's de-facto
// owner/admin created via the Realm Setup Wizard - still has the schema
// default realmRole "technician". Without this backfill, switching on
// realmRole would immediately lock every existing admin out of managing
// their own team.
//
// Only touches technicians that are level 3 (the old admin-equivalent bar)
// AND still have the untouched default realmRole "technician" - safe to
// re-run, since a technician who already has some other realmRole (meaning
// this backfill or a manual change already ran for them) is left alone.
//
// This talks to the real configured MongoDB (MONGODB_URI) - back up the
// database before running this against anything you care about.
//
// Usage: node scripts/backfill-realm-roles.mjs

import "dotenv/config";
import mongoose from "mongoose";
import Technician from "../src/models/Technician.js";

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  const result = await Technician.updateMany(
    { realmId: { $ne: null }, level: 3, realmRole: "technician" },
    { $set: { realmRole: "realm_owner" } }
  );
  console.log(`Backfilled ${result.modifiedCount} of ${result.matchedCount} matched level-3 technician(s) to realmRole "realm_owner".`);

  await mongoose.disconnect();
}

main().catch(error => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
