import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { io as ioClient } from "socket.io-client";
import { startTestSocketServer, stopTestSocketServer } from "../test-support/testSocketServer.mjs";
import { signAuthToken, AUTH_COOKIE_NAME } from "../src/services/authService.js";
import { emitToRealm, emitToTechnician } from "../src/services/realtimeService.js";

// No database needed here - only JWT cookies and the socket.io wiring
// itself are under test (does a client join the right realm room, does
// emitToRealm only reach that room).
const REALM_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const REALM_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

let server;

function connectAs(realmId, port, technicianId = `TECH-${realmId}`) {
  const token = signAuthToken({ technicianId, username: `user-${technicianId}`, name: "Test User", role: "Technician", level: 1, realmId, realmRole: "technician" });
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `${AUTH_COOKIE_NAME}=${token}` }
  });
}

test.before(async () => { server = await startTestSocketServer(); });
test.after(async () => { await stopTestSocketServer(server); });

test("a realm-scoped emit only reaches sockets in that realm's room", async () => {
  const clientA = connectAs(REALM_A, server.port);
  const clientB = connectAs(REALM_B, server.port);

  await Promise.all([
    new Promise(resolve => clientA.on("connect", resolve)),
    new Promise(resolve => clientB.on("connect", resolve))
  ]);

  const receivedByA = [];
  const receivedByB = [];
  clientA.on("device_updated", payload => receivedByA.push(payload));
  clientB.on("device_updated", payload => receivedByB.push(payload));

  emitToRealm(REALM_B, "device_updated", { deviceId: "DEV-B1" });

  // Give the event loop a tick for the message to arrive (or not).
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(receivedByB.length, 1, "Realm B's own socket should receive the event");
  assert.equal(receivedByB[0].deviceId, "DEV-B1");
  assert.equal(receivedByA.length, 0, "Realm A's socket must NOT receive Realm B's event");

  clientA.close();
  clientB.close();
});

test("a socket with no realmId (platform admin, no entered realm) receives no realm-scoped events", async () => {
  const token = signAuthToken({ technicianId: "PLATFORM-1", username: "platformadmin", name: "Platform Admin", platformRole: "platform_super_admin" });
  const client = ioClient(`http://localhost:${server.port}`, { transports: ["websocket"], extraHeaders: { Cookie: `${AUTH_COOKIE_NAME}=${token}` } });
  await new Promise(resolve => client.on("connect", resolve));

  const received = [];
  client.on("device_updated", payload => received.push(payload));

  emitToRealm(REALM_A, "device_updated", { deviceId: "DEV-A1" });
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(received.length, 0);
  client.close();
});

test("emitToTechnician (a DM) only reaches that technician's own socket, not their whole realm room", async () => {
  const clientAlice = connectAs(REALM_A, server.port, "TECH-ALICE");
  const clientBob = connectAs(REALM_A, server.port, "TECH-BOB");

  await Promise.all([
    new Promise(resolve => clientAlice.on("connect", resolve)),
    new Promise(resolve => clientBob.on("connect", resolve))
  ]);

  const receivedByAlice = [];
  const receivedByBob = [];
  clientAlice.on("chat_message", payload => receivedByAlice.push(payload));
  clientBob.on("chat_message", payload => receivedByBob.push(payload));

  emitToTechnician("TECH-BOB", "chat_message", { text: "private to Bob" });
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(receivedByBob.length, 1, "Bob's own socket should receive the DM");
  assert.equal(receivedByAlice.length, 0, "Alice must NOT receive Bob's DM even though they share a realm room");

  clientAlice.close();
  clientBob.close();
});
