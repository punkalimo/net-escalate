import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startInMemoryMongo, stopInMemoryMongo } from "../test-support/inMemoryMongo.mjs";
import { buildTestApp } from "../test-support/testApp.mjs";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import AuditLog from "../src/models/AuditLog.js";
import { hashPassword } from "../src/services/authService.js";

let app;
let platformAgent;
let realmA;

test.before(async () => {
  await startInMemoryMongo();
  app = buildTestApp();

  realmA = await Realm.create({ name: "Realm A Corp", slug: "realm-a" });
  const passwordHash = await hashPassword("TestPass123!");
  await Technician.create({ technicianId: "PLATFORM-1", realmId: null, username: "platformadmin", passwordHash, name: "Platform Admin", platformRole: "platform_super_admin", active: true });

  platformAgent = request.agent(app);
  await platformAgent.post("/api/auth/login").send({ username: "platformadmin", password: "TestPass123!" });
});

test.after(async () => {
  await stopInMemoryMongo();
});

test("a successful login writes a LOGIN audit entry", async () => {
  const entries = await AuditLog.find({ action: "LOGIN" }).lean();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actorName, "Platform Admin");
});

test("a failed login writes a LOGIN_FAILED audit entry with no actor", async () => {
  const res = await request(app).post("/api/auth/login").send({ username: "platformadmin", password: "WrongPassword!" });
  assert.equal(res.status, 401);
  const entries = await AuditLog.find({ action: "LOGIN_FAILED" }).lean();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actorTechnicianId, null);
});

test("creating a realm writes a REALM_CREATED audit entry", async () => {
  const res = await platformAgent.post("/api/platform/realms").send({ name: "New Corp", slug: "new-corp" });
  assert.equal(res.status, 201);
  const entries = await AuditLog.find({ action: "REALM_CREATED", targetId: res.body.realm._id }).lean();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].metadata.slug, "new-corp");
});

test("suspending a realm writes a REALM_SUSPENDED audit entry", async () => {
  const res = await platformAgent.patch(`/api/platform/realms/${realmA._id}`).send({ status: "suspended" });
  assert.equal(res.status, 200);
  const entries = await AuditLog.find({ action: "REALM_SUSPENDED", targetId: String(realmA._id) }).lean();
  assert.equal(entries.length, 1);
});

test("Enter Realm and Exit Realm each write their own audit entry", async () => {
  await platformAgent.post(`/api/platform/realms/${realmA._id}/enter`).send({ reason: "investigating a ticket" });
  await platformAgent.post("/api/platform/exit-realm");

  const enterEntries = await AuditLog.find({ action: "PLATFORM_ENTERED_REALM", targetId: String(realmA._id) }).lean();
  assert.equal(enterEntries.length, 1);
  assert.equal(enterEntries[0].metadata.reason, "investigating a ticket");

  const exitEntries = await AuditLog.find({ action: "PLATFORM_EXITED_REALM" }).lean();
  assert.equal(exitEntries.length, 1);
});

test("audit log is queryable filtered by realmId", async () => {
  const res = await platformAgent.get(`/api/platform/audit?realmId=${realmA._id}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.every(entry => String(entry.realmId) === String(realmA._id)));
});
