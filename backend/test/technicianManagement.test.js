import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startInMemoryMongo, stopInMemoryMongo } from "../test-support/inMemoryMongo.mjs";
import { buildTestApp } from "../test-support/testApp.mjs";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import { hashPassword } from "../src/services/authService.js";

let app;
let realm;
let ownerAgent, adminAgent, plainAgent;
let plainTech;

test.before(async () => {
  await startInMemoryMongo();
  app = buildTestApp();

  realm = await Realm.create({ name: "Manager Test Realm", slug: "manager-test" });
  const passwordHash = await hashPassword("TestPass123!");

  await Technician.create({ technicianId: "OWNER-1", realmId: realm._id, username: "owner1", passwordHash, name: "Owner One", phone: "+10000000010", level: 3, role: "Realm Owner", realmRole: "realm_owner", active: true });
  await Technician.create({ technicianId: "ADMIN-1", realmId: realm._id, username: "admin1", passwordHash, name: "Admin One", phone: "+10000000011", level: 3, role: "Realm Admin", realmRole: "realm_admin", active: true });
  plainTech = await Technician.create({ technicianId: "PLAIN-1", realmId: realm._id, username: "plain1", passwordHash, name: "Plain One", phone: "+10000000012", level: 1, role: "Network Technician", realmRole: "technician", active: true });

  ownerAgent = request.agent(app);
  await ownerAgent.post("/api/auth/login").send({ username: "owner1", password: "TestPass123!" });

  adminAgent = request.agent(app);
  await adminAgent.post("/api/auth/login").send({ username: "admin1", password: "TestPass123!" });

  plainAgent = request.agent(app);
  await plainAgent.post("/api/auth/login").send({ username: "plain1", password: "TestPass123!" });
});

test.after(async () => {
  await stopInMemoryMongo();
});

test("a plain technician realmRole is rejected on every account-management route", async () => {
  const createRes = await plainAgent.post("/api/technicians").send({ technicianId: "NEW-1", name: "New Guy", phone: "+10000000099", level: 1 });
  assert.equal(createRes.status, 403);

  const patchRes = await plainAgent.patch(`/api/technicians/${plainTech.technicianId}`).send({ active: false });
  assert.equal(patchRes.status, 403);

  const deleteRes = await plainAgent.delete(`/api/technicians/${plainTech.technicianId}`);
  assert.equal(deleteRes.status, 403);

  const credRes = await plainAgent.post(`/api/technicians/${plainTech.technicianId}/credentials`).send({ username: "hijack", password: "Whatever123!" });
  assert.equal(credRes.status, 403);

  const roleRes = await plainAgent.patch(`/api/technicians/${plainTech.technicianId}/role`).send({ realmRole: "senior_engineer" });
  assert.equal(roleRes.status, 403);

  const perfRes = await plainAgent.get("/api/technicians/performance");
  assert.equal(perfRes.status, 403);
});

test("a realm_admin can deactivate and manage a plain technician", async () => {
  const patchRes = await adminAgent.patch(`/api/technicians/${plainTech.technicianId}`).send({ active: false });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.technician.active, false);

  // Restore for later tests.
  const restoreRes = await adminAgent.patch(`/api/technicians/${plainTech.technicianId}`).send({ active: true });
  assert.equal(restoreRes.status, 200);
});

test("a realm_admin cannot grant the realm_owner role, but a realm_owner can", async () => {
  const deniedRes = await adminAgent.patch(`/api/technicians/${plainTech.technicianId}/role`).send({ realmRole: "realm_owner" });
  assert.equal(deniedRes.status, 403);

  const grantedRes = await ownerAgent.patch(`/api/technicians/${plainTech.technicianId}/role`).send({ realmRole: "senior_engineer" });
  assert.equal(grantedRes.status, 200);
  assert.equal(grantedRes.body.technician.realmRole, "senior_engineer");

  const ownerGrantRes = await ownerAgent.patch(`/api/technicians/${plainTech.technicianId}/role`).send({ realmRole: "realm_owner" });
  assert.equal(ownerGrantRes.status, 200);
  assert.equal(ownerGrantRes.body.technician.realmRole, "realm_owner");

  // Restore for later tests.
  await ownerAgent.patch(`/api/technicians/${plainTech.technicianId}/role`).send({ realmRole: "technician" });
});

test("an invalid realmRole value is rejected", async () => {
  const res = await ownerAgent.patch(`/api/technicians/${plainTech.technicianId}/role`).send({ realmRole: "super_hacker" });
  assert.equal(res.status, 400);
});

test("a realm manager sees the team performance rollup with zeroed stats for a technician with no incident history", async () => {
  const res = await adminAgent.get("/api/technicians/performance");
  assert.equal(res.status, 200);
  const row = res.body.performance.find(p => p.technicianId === "PLAIN-1");
  assert.ok(row);
  assert.equal(row.callsReceived, 0);
  assert.equal(row.acknowledgeRate, null);
  assert.equal(row.activeIncidents, 0);
});

test("self-service profile update requires only a valid session, not a manager role", async () => {
  const res = await plainAgent.patch("/api/auth/me").send({ name: "Plain One Updated", phone: "+10000000013" });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, "Plain One Updated");

  const stillThere = await Technician.findOne({ technicianId: "PLAIN-1" });
  assert.equal(stillThere.phone, "+10000000013");
});

test("self-service credential change rejects the wrong current password with a 400 (not 401 - the session itself is still valid, and a 401 here would trip the frontend's global force-logout interceptor)", async () => {
  const res = await plainAgent.post("/api/auth/me/credentials").send({ currentPassword: "WrongPassword1!", newPassword: "NewPassword123!" });
  assert.equal(res.status, 400);
});

test("self-service credential change succeeds with the correct current password and the re-issued session works immediately", async () => {
  const res = await plainAgent.post("/api/auth/me/credentials").send({ currentPassword: "TestPass123!", newUsername: "plain1renamed", newPassword: "NewPassword123!" });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, "plain1renamed");

  // The cookie set on this response must already reflect the change - no
  // re-login required - since the agent's cookie jar carries it forward.
  const meRes = await plainAgent.get("/api/auth/me");
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.username, "plain1renamed");

  const reloginRes = await request(app).post("/api/auth/login").send({ username: "plain1renamed", password: "NewPassword123!" });
  assert.equal(reloginRes.status, 200);
});
