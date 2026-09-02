// Deterministic hackathon/demo data: a small realm with a topology and an
// active, correlated multi-incident WAN degradation - built specifically
// for the "Agentic NOC" demo script in docs/WEBMCP.md.
//
// Idempotent: re-running this script against the same database updates the
// existing demo realm/devices/incidents in place (matched by slug/deviceId/
// incidentId) rather than creating duplicates, so judges/CI can run it more
// than once safely.
//
// Usage:
//   cd backend && node scripts/seed-demo-scenario.mjs
//
// Topology built (Core-Router-01's WAN link is the deliberate root cause):
//
//   Upstream-Router
//         |  WAN (degraded: errors + packet loss)
//   Core-Router-01
//     |         |
//   Distribution-Switch-01   Distribution-Switch-02
//     |
//   Access-Switch-01
//
// SNMP is deliberately left disabled on every seeded device - there is no
// real hardware behind these IPs. Topology edges instead come from each
// device's parentDeviceId (see topologyService.js's fallback, added
// specifically to support this) so get_network_topology/the Topology view
// work immediately with no live SNMP required.

import "dotenv/config";
import mongoose from "mongoose";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import Site from "../src/models/Site.js";
import Device from "../src/models/Device.js";
import Incident from "../src/models/Incident.js";
import { hashPassword } from "../src/services/authService.js";
import { buildTimelineEvent } from "../src/services/timelineService.js";

const REALM_SLUG = "demo-noc";
const DEMO_PASSWORD = "DemoPass123!";

async function upsertRealm() {
  let realm = await Realm.findOne({ slug: REALM_SLUG });
  if (!realm) {
    realm = await Realm.create({ name: "Demo NOC", slug: REALM_SLUG, description: "Deterministic demo realm for the WebMCP Agentic NOC challenge.", industry: "Enterprise", subscriptionPlan: "enterprise" });
    console.log(`Created demo realm "${realm.name}" (${realm._id}).`);
  } else {
    console.log(`Reusing existing demo realm "${realm.name}" (${realm._id}).`);
  }
  return realm;
}

// technicianId (like deviceId and incidentId below) is UNIQUE ACROSS THE
// WHOLE DATABASE, not per-realm - see Technician.js/Device.js/Incident.js.
// Every "does this already exist" lookup in this script therefore MUST
// check which realm the existing document actually belongs to before
// touching it, and refuse (loudly) rather than silently overwrite a
// document that turns out to belong to a different realm. An earlier
// version of this script skipped that check for incidentId specifically
// and corrupted a real, unrelated incident whose random-generated id
// happened to collide with this script's hardcoded "NET-1002". Every id
// this script chooses is also namespaced (DEMO-*, DEV-CORE-01 etc., the
// NET-9000x range - see below) specifically to make a collision with the
// app's own random id generation implausible; this check is defense in
// depth on top of that, not a replacement for it.
function assertOwnedByThisRealm(existing, realm, kind) {
  if (existing && String(existing.realmId) !== String(realm._id)) {
    throw new Error(`Refusing to overwrite an existing ${kind} (id matches this demo scenario's, but it belongs to a different realm: ${existing.realmId}). This would corrupt unrelated data - pick a different id.`);
  }
}

// Deliberately NOT a findOneAndUpdate(..., { upsert: true, setDefaultsOnInsert: true }):
// that combination forces Mongoose to write username's schema default
// (null) onto every inserted technician that has no login, and Technician's
// `username` index is `unique: true, sparse: true` - a sparse index only
// excludes a document where the field is entirely ABSENT, not one where
// it's present with value null, so a second passwordless technician
// collides with the first one's literal `username: null`. Plain
// `Technician.create()` (used below) leaves an omitted optional field
// genuinely absent instead, which is what the sparse index expects - the
// same reason technicianRoutes.js's own POST route (creating an
// escalation-only contact with no login) works today.
async function upsertTechnician(realm, { technicianId, username, name, phone, level, role, realmRole }) {
  const passwordHash = username ? await hashPassword(DEMO_PASSWORD) : undefined;
  const fields = { realmId: realm._id, name, phone, level, role, active: true, ...(realmRole ? { realmRole } : {}), ...(username ? { username, passwordHash } : {}) };

  const existing = await Technician.findOne({ technicianId });
  assertOwnedByThisRealm(existing, realm, "technician");
  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    return existing;
  }
  return Technician.create({ technicianId, ...fields });
}

async function upsertSite(realm, name) {
  let site = await Site.findOne({ realmId: realm._id, name });
  if (!site) site = await Site.create({ realmId: realm._id, name, address: "1 Demo Way", description: "Primary demo data center." });
  return site;
}

// monitoringEnabled: false is deliberate and important, not an oversight -
// these devices have no real hardware behind their IPs, so leaving live
// ICMP/SNMP monitoring on would have the background monitoring sweep
// (deviceMonitoringService.js) mark them DOWN and raise its own real
// DEVICE_MONITOR incidents within a poll cycle or two, silently overwriting
// the hand-crafted DEGRADED status and error counters this scenario
// depends on, and adding noise beyond the 4 incidents the demo script
// walks through. This only affects these specific seeded devices - it
// does not touch monitoring for any real device in any other realm.
async function upsertDevice(realm, siteId, fields) {
  const existing = await Device.findOne({ deviceId: fields.deviceId });
  assertOwnedByThisRealm(existing, realm, "device");
  const device = await Device.findOneAndUpdate(
    { deviceId: fields.deviceId },
    { $set: { realmId: realm._id, siteId, monitoringEnabled: false, monitoringMethods: ["icmp"], snmp: { enabled: false }, ...fields } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return device;
}

async function upsertIncident(realm, fields) {
  const existing = await Incident.findOne({ incidentId: fields.incidentId });
  assertOwnedByThisRealm(existing, realm, "incident");
  if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    return existing;
  }
  return Incident.create({ realmId: realm._id, ...fields });
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured.");
  await mongoose.connect(process.env.MONGODB_URI);

  const realm = await upsertRealm();

  const owner = await upsertTechnician(realm, { technicianId: "DEMO-OWNER", username: "demo", name: "Demo NOC Owner", phone: "+15550000001", level: 3, role: "Realm Owner", realmRole: "realm_owner" });
  await upsertTechnician(realm, { technicianId: "DEMO-L1", name: "Priya Nair", phone: "+15550000010", level: 1, role: "Network Technician" });
  const senior = await upsertTechnician(realm, { technicianId: "DEMO-L3", name: "Marcus Chen", phone: "+15550000030", level: 3, role: "Senior Network Team" });

  const site = await upsertSite(realm, "HQ Data Center");

  const upstream = await upsertDevice(realm, site._id, { hostname: "Upstream-Router", ipAddress: "203.0.113.1", deviceType: "router", vendor: "Cisco", model: "ASR9001", role: "edge", status: "UP", deviceId: "DEV-UPSTREAM" });
  const core = await upsertDevice(realm, site._id, {
    hostname: "Core-Router-01",
    ipAddress: "10.10.0.1",
    deviceType: "router",
    vendor: "Cisco",
    model: "ASR1001-X",
    role: "core",
    status: "DEGRADED",
    parentDeviceId: upstream.deviceId,
    deviceId: "DEV-CORE-01",
    interfaces: [
      {
        name: "Gi0/0/0",
        ifIndex: 1,
        description: "WAN uplink to Upstream-Router",
        status: "UP",
        adminState: "UP",
        monitored: true,
        metrics: {
          speedMbps: 1000,
          duplex: "full",
          utilizationPercent: 94,
          inBps: 118000000,
          outBps: 96000000,
          inErrors: 4820,
          outErrors: 3110,
          inDiscards: 960,
          outDiscards: 740,
          errorRatePerMin: 62,
          discardRatePerMin: 18,
          health: "CRITICAL",
          healthReasons: ["Error rate 62/min exceeds critical threshold", "Utilization 94% - approaching saturation", "Discards rising alongside errors - likely a physical/upstream WAN fault"],
          checkedAt: new Date()
        }
      }
    ]
  });
  const dist1 = await upsertDevice(realm, site._id, { hostname: "Distribution-Switch-01", ipAddress: "10.10.1.1", deviceType: "switch", vendor: "Cisco", model: "C9300", role: "edge", status: "DEGRADED", parentDeviceId: core.deviceId, deviceId: "DEV-DIST-01" });
  const dist2 = await upsertDevice(realm, site._id, { hostname: "Distribution-Switch-02", ipAddress: "10.10.1.2", deviceType: "switch", vendor: "Cisco", model: "C9300", role: "edge", status: "DEGRADED", parentDeviceId: core.deviceId, deviceId: "DEV-DIST-02" });
  const access1 = await upsertDevice(realm, site._id, { hostname: "Access-Switch-01", ipAddress: "10.10.2.1", deviceType: "switch", vendor: "Cisco", model: "C9200", role: "access", status: "DEGRADED", parentDeviceId: dist1.deviceId, deviceId: "DEV-ACCESS-01" });

  const rootIncident = await upsertIncident(realm, {
    incidentId: "NET-90001",
    device: core.hostname,
    deviceId: core.deviceId,
    location: site.name,
    severity: "critical",
    description: "Core-Router-01 WAN uplink (Gi0/0/0) is showing a sharp rise in input/output errors and discards over the last ~18 minutes, with utilization sustained above 90%. Multiple downstream devices are reporting degraded connectivity.",
    status: "ESCALATING",
    source: "INTERFACE_HEALTH",
    interfaceName: "Gi0/0/0",
    escalationLevel: 2,
    technician: { id: senior.technicianId, name: senior.name, phone: senior.phone, role: senior.role },
    correlationGroupId: "COR-NET-90001",
    correlationRole: "ROOT",
    severityReasons: ["Core-tier device", "Error rate exceeds critical threshold", "Multiple downstream incidents correlated"],
    impactedDevices: [
      { deviceId: dist1.deviceId, hostname: dist1.hostname, status: dist1.status },
      { deviceId: dist2.deviceId, hostname: dist2.hostname, status: dist2.status },
      { deviceId: access1.deviceId, hostname: access1.hostname, status: access1.status }
    ],
    timeline: [buildTimelineEvent("INCIDENT_CREATED", "Interface health monitor detected a critical error rate on Gi0/0/0.", { actor: "interface health monitor" })]
  });

  const childDefs = [
    { incidentId: "NET-90002", device: dist1, description: "Distribution-Switch-01 is reporting intermittent packet loss to downstream access switches, consistent with its upstream Core-Router-01 uplink degrading." },
    { incidentId: "NET-90003", device: dist2, description: "Distribution-Switch-02 is reporting intermittent packet loss, consistent with its upstream Core-Router-01 uplink degrading." },
    { incidentId: "NET-90004", device: access1, description: "Access-Switch-01 end users are reporting slow internet connectivity." }
  ];
  for (const child of childDefs) {
    await upsertIncident(realm, {
      incidentId: child.incidentId,
      device: child.device.hostname,
      deviceId: child.device.deviceId,
      location: site.name,
      severity: "high",
      description: child.description,
      status: "ESCALATING",
      source: "DEVICE_MONITOR",
      escalationLevel: 1,
      technician: { id: "DEMO-L1", name: "Priya Nair", phone: "+15550000010", role: "Network Technician" },
      correlationGroupId: "COR-NET-90001",
      correlationRole: "CHILD",
      parentIncidentId: rootIncident.incidentId,
      correlationConfidence: 88,
      correlationEvidence: ["Same topology branch as Core-Router-01", "Onset within 5 minutes of the root incident"],
      timeline: [buildTimelineEvent("INCIDENT_CREATED", "Device monitor detected degraded connectivity.", { actor: "device monitor" })]
    });
  }

  await mongoose.disconnect();

  console.log("\nDemo scenario seeded.");
  console.log(`  Realm: ${realm.name} (slug: ${realm.slug})`);
  console.log(`  Login: username "demo", password "${DEMO_PASSWORD}"`);
  console.log(`  Root incident: ${rootIncident.incidentId} on ${core.hostname} (Gi0/0/0)`);
  console.log(`  Correlated children: ${childDefs.map(c => c.incidentId).join(", ")}`);
  console.log(`  Senior technician for escalation: ${senior.name} (${senior.technicianId})`);
  console.log(`  Owner technician created: ${owner.technicianId}`);
}

main().catch(error => {
  console.error("seed-demo-scenario failed:", error);
  process.exit(1);
});
