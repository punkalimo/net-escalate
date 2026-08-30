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

let app;
let realmA, realmB;
let siteA;
let platformAgent;
let realmAgent;

test.before(async () => {
  await startInMemoryMongo();
  app = buildTestApp();

  realmA = await Realm.create({ name: "Realm A Corp", slug: "realm-a" });
  realmB = await Realm.create({ name: "Realm B Corp", slug: "realm-b" });

  const passwordHash = await hashPassword("TestPass123!");
  await Technician.create({ technicianId: "TECH-A1", realmId: realmA._id, username: "usera", passwordHash, name: "User A", phone: "+10000000001", level: 3, realmRole: "realm_owner", active: true });
  await Technician.create({ technicianId: "PLATFORM-1", realmId: null, username: "platformadmin", passwordHash, name: "Platform Admin", platformRole: "platform_super_admin", active: true });

  siteA = await Site.create({ realmId: realmA._id, name: "Realm A HQ" });
  await Device.create({ deviceId: "DEV-A1", realmId: realmA._id, hostname: "router-a", ipAddress: "10.0.0.1", monitoringMethods: ["icmp"], siteId: siteA._id });
  await Device.create({ deviceId: "DEV-B1", realmId: realmB._id, hostname: "router-b", ipAddress: "10.0.0.2", monitoringMethods: ["icmp"] });
  await Incident.create({ incidentId: "NET-A001", realmId: realmA._id, device: "router-a", deviceId: "DEV-A1", location: "Site A", severity: "high", description: "Realm A incident", technician: { id: "TECH-A1", name: "User A", phone: "+10000000001" }, escalationLevel: 2 });

  realmAgent = request.agent(app);
  await realmAgent.post("/api/auth/login").send({ username: "usera", password: "TestPass123!" });

  platformAgent = request.agent(app);
  const login = await platformAgent.post("/api/auth/login").send({ username: "platformadmin", password: "TestPass123!" });
  assert.equal(login.status, 200);
});

test.after(async () => {
  await stopInMemoryMongo();
});

test("a normal realm user gets 403 on every /api/platform/* route", async () => {
  const routes = ["/api/platform/realms", "/api/platform/overview", "/api/platform/technicians", "/api/platform/devices", "/api/platform/incidents", "/api/platform/analytics", "/api/platform/audit"];
  for (const route of routes) {
    const res = await realmAgent.get(route);
    assert.equal(res.status, 403, `expected 403 for ${route}, got ${res.status}`);
  }
});

test("platform admin can list both realms with aggregated counts", async () => {
  const res = await platformAgent.get("/api/platform/realms");
  assert.equal(res.status, 200);
  const slugs = res.body.realms.map(r => r.slug);
  assert.ok(slugs.includes("realm-a"));
  assert.ok(slugs.includes("realm-b"));
  const realmARow = res.body.realms.find(r => r.slug === "realm-a");
  assert.equal(realmARow.deviceCount, 1);
  assert.equal(realmARow.incidentCount, 1);
});

test("platform admin sees cross-realm devices and incidents", async () => {
  const devicesRes = await platformAgent.get("/api/platform/devices");
  assert.equal(devicesRes.status, 200);
  const deviceIds = devicesRes.body.devices.map(d => d.deviceId);
  assert.ok(deviceIds.includes("DEV-A1"));
  assert.ok(deviceIds.includes("DEV-B1"));

  const incidentsRes = await platformAgent.get("/api/platform/incidents");
  assert.equal(incidentsRes.status, 200);
  assert.ok(incidentsRes.body.incidents.some(i => i.incidentId === "NET-A001"));
});

test("platform admin gets empty results on realm-scoped routes without an Enter Realm context", async () => {
  const res = await platformAgent.get("/api/devices");
  assert.equal(res.status, 200);
  assert.equal(res.body.devices.length, 0);
});

test("Enter Realm scopes subsequent realm-side requests, Exit Realm returns to platform-wide view", async () => {
  const enterRes = await platformAgent.post(`/api/platform/realms/${realmA._id}/enter`).send({ reason: "support investigation" });
  assert.equal(enterRes.status, 200);
  assert.equal(enterRes.body.realm.realmName, "Realm A Corp");

  const scopedRes = await platformAgent.get("/api/devices");
  assert.equal(scopedRes.status, 200);
  assert.equal(scopedRes.body.devices.length, 1);
  assert.equal(scopedRes.body.devices[0].deviceId, "DEV-A1");

  const exitRes = await platformAgent.post("/api/platform/exit-realm");
  assert.equal(exitRes.status, 200);

  const afterExitRes = await platformAgent.get("/api/devices");
  assert.equal(afterExitRes.status, 200);
  assert.equal(afterExitRes.body.devices.length, 0);
});

test("platform overview reports realm/device/incident counts across both realms", async () => {
  const res = await platformAgent.get("/api/platform/overview");
  assert.equal(res.status, 200);
  assert.equal(res.body.realms, 2);
  assert.equal(res.body.devices, 2);
});

test("platform admin can view, edit, and reset credentials for a technician without Entering their realm", async () => {
  const detailRes = await platformAgent.get("/api/platform/technicians/TECH-A1");
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.technician.name, "User A");
  assert.equal(detailRes.body.realmName, "Realm A Corp");
  assert.equal(detailRes.body.technician.passwordHash, undefined);

  const editRes = await platformAgent.patch("/api/platform/technicians/TECH-A1").send({ phone: "+19999999999" });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.technician.phone, "+19999999999");

  const credRes = await platformAgent.post("/api/platform/technicians/TECH-A1/credentials").send({ username: "usera", password: "PlatformReset123!" });
  assert.equal(credRes.status, 200);

  const auditRes = await platformAgent.get("/api/platform/audit").query({ targetId: "TECH-A1" });
  assert.equal(auditRes.status, 200);
  const actions = auditRes.body.entries.map(e => e.action);
  assert.ok(actions.includes("PLATFORM_TECHNICIAN_UPDATED"));
  assert.ok(actions.includes("PLATFORM_TECHNICIAN_CREDENTIALS_RESET"));
});

test("the platform technician list never leaks passwordHash", async () => {
  const res = await platformAgent.get("/api/platform/technicians");
  assert.equal(res.status, 200);
  for (const t of res.body.technicians) assert.equal(t.passwordHash, undefined);
});

test("platform admin can list sites across every realm with device/incident rollups", async () => {
  const res = await platformAgent.get("/api/platform/sites");
  assert.equal(res.status, 200);
  const row = res.body.sites.find(s => String(s._id) === String(siteA._id));
  assert.ok(row);
  assert.equal(row.realmName, "Realm A Corp");
  assert.equal(row.deviceCount, 1);

  const normalRes = await realmAgent.get("/api/platform/sites");
  assert.equal(normalRes.status, 403);
});

test("platform analytics includes cross-realm site and technician performance rollups", async () => {
  const res = await platformAgent.get("/api/platform/analytics");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.sites));
  assert.ok(Array.isArray(res.body.technicians));

  const siteRow = res.body.sites.find(s => s.siteId === String(siteA._id));
  assert.ok(siteRow);
  assert.equal(siteRow.deviceCount, 1);
  assert.equal(siteRow.incidents, 1);
  assert.equal(siteRow.escalated, 1);

  const techRow = res.body.technicians.find(t => t.technicianId === "TECH-A1");
  assert.ok(techRow);
  assert.equal(techRow.realmName, "Realm A Corp");
});
