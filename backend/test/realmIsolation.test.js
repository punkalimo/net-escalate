import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startInMemoryMongo, stopInMemoryMongo } from "../test-support/inMemoryMongo.mjs";
import { buildTestApp } from "../test-support/testApp.mjs";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import Device from "../src/models/Device.js";
import Incident from "../src/models/Incident.js";
import Site from "../src/models/Site.js";
import { hashPassword } from "../src/services/authService.js";
import { stopAllDeviceMonitoring } from "../src/services/deviceMonitoringService.js";
import { stopAllInterfaceMonitoring } from "../src/services/interfaceMonitoringService.js";

let app;
let realmA, realmB;
let deviceA, deviceB;
let incidentA, incidentB;
let siteA, siteB;
let technicianB;
let agentA;

test.before(async () => {
  await startInMemoryMongo();
  app = buildTestApp();

  realmA = await Realm.create({ name: "Realm A Corp", slug: "realm-a" });
  realmB = await Realm.create({ name: "Realm B Corp", slug: "realm-b" });

  const passwordHash = await hashPassword("TestPass123!");
  await Technician.create({ technicianId: "TECH-A1", realmId: realmA._id, username: "usera", passwordHash, name: "User A", phone: "+10000000001", level: 3, realmRole: "realm_owner", active: true });
  technicianB = await Technician.create({ technicianId: "TECH-B1", realmId: realmB._id, username: "userb", passwordHash, name: "User B", phone: "+10000000002", level: 3, realmRole: "realm_owner", active: true });

  deviceA = await Device.create({ deviceId: "DEV-A1", realmId: realmA._id, hostname: "router-a", ipAddress: "10.0.0.1", monitoringMethods: ["icmp"] });
  deviceB = await Device.create({ deviceId: "DEV-B1", realmId: realmB._id, hostname: "router-b", ipAddress: "10.0.0.1", monitoringMethods: ["icmp"] });

  incidentA = await Incident.create({ incidentId: "NET-A001", realmId: realmA._id, device: "router-a", deviceId: "DEV-A1", location: "Site A", severity: "high", description: "Realm A incident", technician: { id: "TECH-A1", name: "User A", phone: "+10000000001" } });
  incidentB = await Incident.create({ incidentId: "NET-B001", realmId: realmB._id, device: "router-b", deviceId: "DEV-B1", location: "Site B", severity: "high", description: "Realm B incident", technician: { id: "TECH-B1", name: "User B", phone: "+10000000002" } });

  siteA = await Site.create({ realmId: realmA._id, name: "Lusaka HQ" });
  siteB = await Site.create({ realmId: realmB._id, name: "Kitwe Branch" });

  agentA = request.agent(app);
  const login = await agentA.post("/api/auth/login").send({ username: "usera", password: "TestPass123!" });
  assert.equal(login.status, 200);
});

test.after(async () => {
  // A successful device PATCH (see the site-assignment test below) starts
  // REAL setInterval-based monitoring for that device via deviceRoutes.js's
  // existing (correct) side effect - those timers otherwise outlive
  // mongoose.disconnect() and keep the process alive indefinitely, hanging
  // the whole test run even though every test itself already passed.
  stopAllDeviceMonitoring();
  stopAllInterfaceMonitoring();
  await stopInMemoryMongo();
});

test("two realms with the same IP address can both be created (compound unique index, not global)", () => {
  assert.equal(deviceA.ipAddress, deviceB.ipAddress);
  assert.notEqual(String(deviceA.realmId), String(deviceB.realmId));
});

test("Realm A cannot GET Realm B's device", async () => {
  const res = await agentA.get(`/api/devices/${deviceB.deviceId}`);
  assert.equal(res.status, 404);
});

test("Realm A cannot GET Realm B's incident", async () => {
  const res = await agentA.get(`/api/incidents/${incidentB.incidentId}`);
  assert.equal(res.status, 404);
});

test("Realm A's own device and incident are still reachable", async () => {
  const deviceRes = await agentA.get(`/api/devices/${deviceA.deviceId}`);
  assert.equal(deviceRes.status, 200);
  assert.equal(deviceRes.body.device.deviceId, deviceA.deviceId);

  const incidentRes = await agentA.get(`/api/incidents/${incidentA.incidentId}`);
  assert.equal(incidentRes.status, 200);
  assert.equal(incidentRes.body.incident.incidentId, incidentA.incidentId);
});

test("Realm A's technician list never includes Realm B's technicians", async () => {
  const res = await agentA.get("/api/technicians");
  assert.equal(res.status, 200);
  const ids = res.body.technicians.map(t => t.technicianId);
  assert.ok(ids.includes("TECH-A1"));
  assert.ok(!ids.includes("TECH-B1"));
});

test("Realm A cannot PATCH Realm B's device", async () => {
  const res = await agentA.patch(`/api/devices/${deviceB.deviceId}`).send({ hostname: "hijacked" });
  assert.equal(res.status, 404);
  const stillIntact = await Device.findById(deviceB._id);
  assert.equal(stillIntact.hostname, "router-b");
});

test("Realm A cannot DELETE Realm B's device", async () => {
  const res = await agentA.delete(`/api/devices/${deviceB.deviceId}`);
  assert.equal(res.status, 404);
  const stillExists = await Device.findById(deviceB._id);
  assert.ok(stillExists);
});

test("Realm A cannot set login credentials on Realm B's technician", async () => {
  const res = await agentA.post(`/api/technicians/${technicianB.technicianId}/credentials`).send({ username: "hijacker", password: "NewPass123!" });
  assert.equal(res.status, 404);
});

test("an unauthenticated request is rejected before any realm scoping runs", async () => {
  const res = await request(app).get("/api/devices");
  assert.equal(res.status, 401);
});

test("Realm A's site list never includes Realm B's sites", async () => {
  const res = await agentA.get("/api/sites");
  assert.equal(res.status, 200);
  const names = res.body.sites.map(s => s.name);
  assert.ok(names.includes("Lusaka HQ"));
  assert.ok(!names.includes("Kitwe Branch"));
});

test("Realm A cannot GET, PATCH, or DELETE Realm B's site", async () => {
  const getRes = await agentA.get(`/api/sites/${siteB._id}`);
  assert.equal(getRes.status, 404);

  const patchRes = await agentA.patch(`/api/sites/${siteB._id}`).send({ name: "hijacked" });
  assert.equal(patchRes.status, 404);
  assert.equal((await Site.findById(siteB._id)).name, "Kitwe Branch");

  const deleteRes = await agentA.delete(`/api/sites/${siteB._id}`);
  assert.equal(deleteRes.status, 404);
  assert.ok(await Site.findById(siteB._id));
});

test("Realm A cannot assign its device to Realm B's site (cross-realm siteId injection)", async () => {
  const res = await agentA.patch(`/api/devices/${deviceA.deviceId}`).send({ siteId: String(siteB._id) });
  assert.equal(res.status, 400);
  const stillUnassigned = await Device.findById(deviceA._id);
  assert.equal(stillUnassigned.siteId, null);
});

test("Realm A can assign its device to its own site and see it in the site's performance overview", async () => {
  const assignRes = await agentA.patch(`/api/devices/${deviceA.deviceId}`).send({ siteId: String(siteA._id) });
  assert.equal(assignRes.status, 200);

  const overviewRes = await agentA.get(`/api/sites/${siteA._id}`);
  assert.equal(overviewRes.status, 200);
  assert.equal(overviewRes.body.deviceCount, 1);
  assert.equal(overviewRes.body.devices[0].deviceId, deviceA.deviceId);

  // The site LIST endpoint's per-site deviceCount comes from Device.aggregate(),
  // which - unlike find()/countDocuments() - does not auto-cast query values,
  // so this exercises a distinct code path from computeSiteOverview() above
  // (a regression once caught deviceCount silently reporting 0 here because
  // req.realmId, a string off the JWT, was matched against a stored ObjectId).
  const listRes = await agentA.get("/api/sites");
  assert.equal(listRes.status, 200);
  const siteARow = listRes.body.sites.find(s => String(s._id) === String(siteA._id));
  assert.equal(siteARow.deviceCount, 1);
  assert.equal(listRes.body.unassignedDeviceCount, 0);
});
