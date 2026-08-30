// One-time (but safely re-runnable) migration: introduces the Realm model
// and backfills every existing tenant-owned document into a single "Default
// Organization" realm, then fixes Device's unique index from a single
// global ipAddress constraint to a realmId+ipAddress compound one.
//
// This talks to the real configured MongoDB (MONGODB_URI) - back up the
// database before running this against anything you care about.
//
// Usage: node scripts/migrate-to-realms.mjs

import "dotenv/config";
import mongoose from "mongoose";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import Device from "../src/models/Device.js";
import Incident from "../src/models/Incident.js";
import InterfaceSample from "../src/models/InterfaceSample.js";
import DeviceSystemSample from "../src/models/DeviceSystemSample.js";
import ConfigSnapshot from "../src/models/ConfigSnapshot.js";

const DEFAULT_REALM_SLUG = "default";

async function ensureDefaultRealm() {
  let realm = await Realm.findOne({ slug: DEFAULT_REALM_SLUG });
  if (realm) {
    console.log(`Default realm already exists (${realm._id}).`);
    return realm;
  }
  realm = await Realm.create({ name: "Default Organization", slug: DEFAULT_REALM_SLUG, description: "Auto-created during the multi-tenant migration to hold all pre-existing data.", industry: "Other", status: "active" });
  console.log(`Created default realm "${realm.name}" (${realm._id}).`);
  return realm;
}

async function backfillRealmId(Model, name, realmId) {
  const result = await Model.updateMany({ realmId: { $exists: false } }, { $set: { realmId } });
  console.log(`${name}: backfilled ${result.modifiedCount} of ${result.matchedCount} matched document(s).`);
}

async function fixDeviceIpIndex() {
  const collection = Device.collection;
  const indexes = await collection.indexes();

  const staleIpIndex = indexes.find(index => index.key && Object.keys(index.key).length === 1 && index.key.ipAddress === 1 && index.unique);
  if (staleIpIndex) {
    await collection.dropIndex(staleIpIndex.name);
    console.log(`Dropped stale global-unique index "${staleIpIndex.name}" on Device.ipAddress.`);
  } else {
    console.log("No stale global-unique ipAddress index found (already migrated or never existed).");
  }

  const hasCompound = indexes.some(index => index.key && index.key.realmId === 1 && index.key.ipAddress === 1 && index.unique);
  if (!hasCompound) {
    await collection.createIndex({ realmId: 1, ipAddress: 1 }, { unique: true });
    console.log("Created compound unique index on Device (realmId, ipAddress).");
  } else {
    console.log("Compound (realmId, ipAddress) unique index already exists.");
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  const realm = await ensureDefaultRealm();

  await backfillRealmId(Technician, "Technician", realm._id);
  await backfillRealmId(Device, "Device", realm._id);
  await backfillRealmId(Incident, "Incident", realm._id);
  await backfillRealmId(InterfaceSample, "InterfaceSample", realm._id);
  await backfillRealmId(DeviceSystemSample, "DeviceSystemSample", realm._id);
  await backfillRealmId(ConfigSnapshot, "ConfigSnapshot", realm._id);

  await fixDeviceIpIndex();

  console.log("\nMigration complete.");
  console.log(`Default realm id: ${realm._id}`);
  await mongoose.disconnect();
}

main().catch(error => {
  console.error("Migration failed:", error);
  process.exit(1);
});
