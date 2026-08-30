import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { startInMemoryMongo, stopInMemoryMongo } from "../test-support/inMemoryMongo.mjs";
import { buildTestApp } from "../test-support/testApp.mjs";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import Message from "../src/models/Message.js";
import { hashPassword } from "../src/services/authService.js";
import { postSystemMessage } from "../src/services/chatService.js";

let app;
let realmA, realmB;
let aliceAgent, bobAgent, carolAgent, otherRealmAgent;

test.before(async () => {
  await startInMemoryMongo();
  app = buildTestApp();

  realmA = await Realm.create({ name: "Realm A Corp", slug: "realm-a" });
  realmB = await Realm.create({ name: "Realm B Corp", slug: "realm-b" });

  const passwordHash = await hashPassword("TestPass123!");
  await Technician.create({ technicianId: "TECH-ALICE", realmId: realmA._id, username: "alice", passwordHash, name: "Alice", phone: "+10000000001", level: 1, realmRole: "technician", active: true });
  await Technician.create({ technicianId: "TECH-BOB", realmId: realmA._id, username: "bob", passwordHash, name: "Bob", phone: "+10000000002", level: 1, realmRole: "technician", active: true });
  await Technician.create({ technicianId: "TECH-CAROL", realmId: realmA._id, username: "carol", passwordHash, name: "Carol", phone: "+10000000003", level: 1, realmRole: "technician", active: true });
  await Technician.create({ technicianId: "TECH-OTHER", realmId: realmB._id, username: "otherrealm", passwordHash, name: "Other Realm User", phone: "+10000000004", level: 1, realmRole: "technician", active: true });

  aliceAgent = request.agent(app);
  await aliceAgent.post("/api/auth/login").send({ username: "alice", password: "TestPass123!" });
  bobAgent = request.agent(app);
  await bobAgent.post("/api/auth/login").send({ username: "bob", password: "TestPass123!" });
  carolAgent = request.agent(app);
  await carolAgent.post("/api/auth/login").send({ username: "carol", password: "TestPass123!" });
  otherRealmAgent = request.agent(app);
  await otherRealmAgent.post("/api/auth/login").send({ username: "otherrealm", password: "TestPass123!" });
});

test.after(async () => {
  // The attachment tests write real files under backend/uploads/<realmId>/ -
  // clean up so repeated test runs don't litter the real uploads directory.
  fs.rmSync(path.join(process.cwd(), "uploads", String(realmA._id)), { recursive: true, force: true });
  await stopInMemoryMongo();
});

test("team messages are realm-isolated", async () => {
  const postRes = await aliceAgent.post("/api/messages/team").send({ text: "hello team" });
  assert.equal(postRes.status, 201);
  assert.equal(postRes.body.message.senderName, "Alice");

  const sameRealmRes = await bobAgent.get("/api/messages/team");
  assert.equal(sameRealmRes.status, 200);
  assert.ok(sameRealmRes.body.messages.some(m => m.text === "hello team"));

  const otherRealmRes = await otherRealmAgent.get("/api/messages/team");
  assert.equal(otherRealmRes.status, 200);
  assert.ok(!otherRealmRes.body.messages.some(m => m.text === "hello team"));
});

test("a team message requires text or an attachment", async () => {
  const res = await aliceAgent.post("/api/messages/team").send({ text: "" });
  assert.equal(res.status, 400);
});

test("DM privacy: a third technician in the same realm cannot read a DM between two others", async () => {
  const sendRes = await aliceAgent.post("/api/messages/dm/TECH-BOB").send({ text: "just between us" });
  assert.equal(sendRes.status, 201);

  const bobReadRes = await bobAgent.get("/api/messages/dm/TECH-ALICE");
  assert.equal(bobReadRes.status, 200);
  assert.ok(bobReadRes.body.messages.some(m => m.text === "just between us"));

  const carolReadRes = await carolAgent.get("/api/messages/dm/TECH-ALICE");
  assert.equal(carolReadRes.status, 200);
  assert.ok(!carolReadRes.body.messages.some(m => m.text === "just between us"), "Carol must not see Alice/Bob's DM history");

  const carolConversationsRes = await carolAgent.get("/api/messages/conversations");
  assert.equal(carolConversationsRes.status, 200);
  assert.equal(carolConversationsRes.body.conversations.length, 0, "Carol has no conversations of her own and must not see Alice/Bob's");

  const aliceConversationsRes = await aliceAgent.get("/api/messages/conversations");
  assert.equal(aliceConversationsRes.status, 200);
  assert.ok(aliceConversationsRes.body.conversations.some(c => c.technicianId === "TECH-BOB"));
});

test("a DM cannot target a technician in a different realm", async () => {
  const res = await aliceAgent.post("/api/messages/dm/TECH-OTHER").send({ text: "cross-realm attempt" });
  assert.equal(res.status, 404);
});

test("an attachment on a team message can be fetched by any realm member; a DM attachment is participant-only", async () => {
  const teamRes = await aliceAgent.post("/api/messages/team").field("text", "see attached").attach("attachment", Buffer.from("hello world"), { filename: "notes.txt", contentType: "text/plain" });
  assert.equal(teamRes.status, 201);
  assert.equal(teamRes.body.message.attachment.kind, "file");

  const teamAttachmentRes = await bobAgent.get(`/api/messages/attachments/${teamRes.body.message._id}`);
  assert.equal(teamAttachmentRes.status, 200);

  const dmRes = await aliceAgent.post("/api/messages/dm/TECH-BOB").field("text", "private file").attach("attachment", Buffer.from("secret"), { filename: "secret.txt", contentType: "text/plain" });
  assert.equal(dmRes.status, 201);

  const bobAttachmentRes = await bobAgent.get(`/api/messages/attachments/${dmRes.body.message._id}`);
  assert.equal(bobAttachmentRes.status, 200);

  const carolAttachmentRes = await carolAgent.get(`/api/messages/attachments/${dmRes.body.message._id}`);
  assert.equal(carolAttachmentRes.status, 403);
});

test("an unsupported file type is rejected", async () => {
  const res = await aliceAgent.post("/api/messages/team").field("text", "bad file").attach("attachment", Buffer.from("#!/bin/sh\necho hi"), { filename: "script.sh", contentType: "application/x-sh" });
  assert.equal(res.status, 400);
});

test("postSystemMessage creates a system-generated team message", async () => {
  const message = await postSystemMessage(realmA._id, "🔴 Critical incident NET-9999 created: test", { linkedIncidentId: "NET-9999" });
  assert.ok(message);
  assert.equal(message.systemGenerated, true);
  assert.equal(message.linkedIncidentId, "NET-9999");
  assert.equal(message.channel, "team");

  const stored = await Message.findById(message._id).lean();
  assert.ok(stored);
  assert.equal(stored.senderId, "system");
});
