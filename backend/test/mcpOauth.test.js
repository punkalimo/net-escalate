// Covers the remote MCP + OAuth bridge (oauthRoutes.js, oauthService.js,
// mcpAuthMiddleware.js, mcpRoutes.js) - see docs/WEBMCP.md's "Remote MCP +
// OAuth" section. Requires the same externally-supplied env vars the rest
// of the suite already needs (JWT_SECRET), plus MCP_OAUTH_REDIRECT_URIS so
// this test's redirect_uri is on the allowlist - see package.json's test
// script / CI config for how these are supplied; there is no committed
// default, matching how JWT_SECRET already works.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import crypto from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startInMemoryMongo, stopInMemoryMongo } from "../test-support/inMemoryMongo.mjs";
import { buildTestApp } from "../test-support/testApp.mjs";
import Realm from "../src/models/Realm.js";
import Technician from "../src/models/Technician.js";
import Device from "../src/models/Device.js";
import { hashPassword } from "../src/services/authService.js";
import { MCP_OAUTH_CLIENT_ID } from "../src/services/oauthService.js";

// MCP_OAUTH_REDIRECT_URIS must already be set in the environment (must
// include the URI below) BEFORE this file is imported - oauthService.js
// reads it once at module load, and ESM import evaluation runs before any
// of this file's own top-level statements, so setting it here would be too
// late. See package.json's test script.
const REDIRECT_URI = "https://chatgpt.example/callback";

let app;
let server;
let baseUrl;
let realmA, realmB;
let deviceA, deviceB;

test.before(async () => {
  await startInMemoryMongo();
  app = buildTestApp();
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  realmA = await Realm.create({ name: "Realm A Corp", slug: "oauth-realm-a" });
  realmB = await Realm.create({ name: "Realm B Corp", slug: "oauth-realm-b" });

  const passwordHash = await hashPassword("TestPass123!");
  await Technician.create({ technicianId: "OAUTH-A0", realmId: realmA._id, username: "oauth-usera", passwordHash, name: "User A", phone: "+10000000001", level: 3, realmRole: "realm_owner", active: true });
  await Technician.create({ technicianId: "OAUTH-B0", realmId: realmB._id, username: "oauth-userb", passwordHash, name: "User B", phone: "+10000000002", level: 3, realmRole: "realm_owner", active: true });
  await Technician.create({ technicianId: "OAUTH-PLATFORM", realmId: null, username: "oauth-platformadmin", passwordHash, name: "Platform Admin", platformRole: "platform_super_admin", active: true });

  deviceA = await Device.create({ deviceId: "OAUTH-DEV-A1", realmId: realmA._id, hostname: "oauth-router-a", ipAddress: "10.9.0.1", monitoringMethods: ["icmp"] });
  deviceB = await Device.create({ deviceId: "OAUTH-DEV-B1", realmId: realmB._id, hostname: "oauth-router-b", ipAddress: "10.9.0.2", monitoringMethods: ["icmp"] });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await stopInMemoryMongo();
});

// ---- PKCE helper -----------------------------------------------------------

function makePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

// Drives the full browser-facing consent flow (GET+POST /oauth/authorize)
// and returns the redirected authorization code - the same path a real
// browser follows when ChatGPT sends the user to /oauth/authorize.
async function getAuthorizationCode({ username, password, realmId, codeChallenge, state = "xyz" }) {
  const authorizeRes = await request(app)
    .post("/oauth/authorize")
    .type("form")
    .send({
      response_type: "code",
      client_id: MCP_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      username,
      password,
      ...(realmId ? { realmId: String(realmId) } : {})
    });
  assert.equal(authorizeRes.status, 302, `expected redirect, got ${authorizeRes.status}: ${authorizeRes.text}`);
  const location = new URL(authorizeRes.headers.location);
  assert.equal(location.origin + location.pathname, REDIRECT_URI);
  assert.equal(location.searchParams.get("state"), state);
  return location.searchParams.get("code");
}

async function exchangeCodeForTokens({ code, codeVerifier }) {
  const res = await request(app).post("/oauth/token").type("form").send({
    grant_type: "authorization_code",
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
    code_verifier: codeVerifier
  });
  return res;
}

async function connectMcpClient(accessToken) {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

// ---- Full flow --------------------------------------------------------------

test("full authorization_code + PKCE flow issues a working access token scoped to the technician's realm", async () => {
  const { codeVerifier, codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge });

  const tokenRes = await exchangeCodeForTokens({ code, codeVerifier });
  assert.equal(tokenRes.status, 200);
  assert.equal(tokenRes.body.token_type, "Bearer");
  assert.ok(tokenRes.body.access_token);
  assert.ok(tokenRes.body.refresh_token);

  const { client, transport } = await connectMcpClient(tokenRes.body.access_token);
  try {
    const result = await client.callTool({ name: "search_devices", arguments: {} });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.success, true);
    assert.equal(payload.devices.length, 1);
    assert.equal(payload.devices[0].hostname, "oauth-router-a");
  } finally {
    await transport.close();
  }
});

test("realm isolation: a token issued for realm B never sees realm A's devices, and vice versa", async () => {
  const pairA = makePkcePair();
  const codeA = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge: pairA.codeChallenge });
  const tokenA = (await exchangeCodeForTokens({ code: codeA, codeVerifier: pairA.codeVerifier })).body;

  const pairB = makePkcePair();
  const codeB = await getAuthorizationCode({ username: "oauth-userb", password: "TestPass123!", codeChallenge: pairB.codeChallenge });
  const tokenB = (await exchangeCodeForTokens({ code: codeB, codeVerifier: pairB.codeVerifier })).body;

  const { client: clientA, transport: transportA } = await connectMcpClient(tokenA.access_token);
  const { client: clientB, transport: transportB } = await connectMcpClient(tokenB.access_token);
  try {
    const resultA = JSON.parse((await clientA.callTool({ name: "search_devices", arguments: {} })).content[0].text);
    const resultB = JSON.parse((await clientB.callTool({ name: "search_devices", arguments: {} })).content[0].text);
    assert.deepEqual(resultA.devices.map(d => d.deviceId), [deviceA.deviceId]);
    assert.deepEqual(resultB.devices.map(d => d.deviceId), [deviceB.deviceId]);
  } finally {
    await transportA.close();
    await transportB.close();
  }
});

test("a platform admin must pick a realm at consent time, and the issued token is scoped to exactly that realm", async () => {
  const { codeVerifier, codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-platformadmin", password: "TestPass123!", realmId: realmB._id, codeChallenge });
  const token = (await exchangeCodeForTokens({ code, codeVerifier })).body;

  const { client, transport } = await connectMcpClient(token.access_token);
  try {
    const payload = JSON.parse((await client.callTool({ name: "search_devices", arguments: {} })).content[0].text);
    assert.deepEqual(payload.devices.map(d => d.deviceId), [deviceB.deviceId]);
  } finally {
    await transport.close();
  }
});

test("platform admin consent without choosing a realm is rejected (no realm, no token)", async () => {
  const { codeChallenge } = makePkcePair();
  const res = await request(app).post("/oauth/authorize").type("form").send({
    response_type: "code",
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    username: "oauth-platformadmin",
    password: "TestPass123!"
  });
  assert.equal(res.status, 400);
  assert.match(res.text, /Choose a realm/);
});

// ---- Negative cases -----------------------------------------------------

test("wrong password is rejected without issuing a code", async () => {
  const { codeChallenge } = makePkcePair();
  const res = await request(app).post("/oauth/authorize").type("form").send({
    response_type: "code",
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    username: "oauth-usera",
    password: "WrongPassword!"
  });
  assert.equal(res.status, 401);
});

test("an unregistered redirect_uri is rejected before any login is attempted", async () => {
  const res = await request(app).get("/oauth/authorize").query({
    response_type: "code",
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: "https://evil.example/callback",
    code_challenge: "abc",
    code_challenge_method: "S256"
  });
  assert.equal(res.status, 400);
});

test("token exchange rejects a mismatched PKCE code_verifier", async () => {
  const { codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge });
  const res = await exchangeCodeForTokens({ code, codeVerifier: "totally-wrong-verifier" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_grant");
});

test("an authorization code can only be redeemed once", async () => {
  const { codeVerifier, codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge });

  const first = await exchangeCodeForTokens({ code, codeVerifier });
  assert.equal(first.status, 200);

  const second = await exchangeCodeForTokens({ code, codeVerifier });
  assert.equal(second.status, 400);
  assert.equal(second.body.error, "invalid_grant");
});

test("an expired or malformed access token is rejected by the MCP endpoint with 401", async () => {
  const res = await request(app).post("/mcp").set("Authorization", "Bearer not-a-real-token").set("Content-Type", "application/json").set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(res.status, 401);
});

test("a request with no Authorization header at all is rejected with 401", async () => {
  const res = await request(app).post("/mcp").set("Content-Type", "application/json").set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(res.status, 401);
});

test("a NetEscalate session cookie JWT is rejected by the MCP endpoint (wrong token type, not a Bearer mcp_access token)", async () => {
  const loginRes = await request(app).post("/api/auth/login").send({ username: "oauth-usera", password: "TestPass123!" });
  const sessionCookie = loginRes.headers["set-cookie"][0];
  const sessionToken = sessionCookie.match(/netescalate_token=([^;]+)/)[1];

  const res = await request(app).post("/mcp").set("Authorization", `Bearer ${sessionToken}`).set("Content-Type", "application/json").set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(res.status, 401);
});

test("refresh_token grant rotates the token and revokes the old refresh token", async () => {
  const { codeVerifier, codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge });
  const first = (await exchangeCodeForTokens({ code, codeVerifier })).body;

  const refreshRes = await request(app).post("/oauth/token").type("form").send({
    grant_type: "refresh_token",
    client_id: MCP_OAUTH_CLIENT_ID,
    refresh_token: first.refresh_token
  });
  assert.equal(refreshRes.status, 200);
  assert.ok(refreshRes.body.access_token);
  assert.notEqual(refreshRes.body.refresh_token, first.refresh_token);

  const reuseRes = await request(app).post("/oauth/token").type("form").send({
    grant_type: "refresh_token",
    client_id: MCP_OAUTH_CLIENT_ID,
    refresh_token: first.refresh_token
  });
  assert.equal(reuseRes.status, 400);
  assert.equal(reuseRes.body.error, "invalid_grant");
});

test("only the 10 read-only tools are exposed on the remote MCP bridge - no create_incident/assign_incident/add_incident_note", async () => {
  const { codeVerifier, codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge });
  const token = (await exchangeCodeForTokens({ code, codeVerifier })).body;

  const { client, transport } = await connectMcpClient(token.access_token);
  try {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    assert.deepEqual(names, [
      "find_available_technicians", "get_active_incidents", "get_device_health", "get_device_interfaces",
      "get_incident", "get_interface_health", "get_network_topology", "get_technician",
      "investigate_incident", "search_devices"
    ]);
    assert.equal(names.includes("create_incident"), false);
    assert.equal(names.includes("assign_incident"), false);
    assert.equal(names.includes("add_incident_note"), false);
  } finally {
    await transport.close();
  }
});

test("/oauth/revoke always returns success (no token-validity oracle) and actually revokes a real refresh token", async () => {
  const { codeVerifier, codeChallenge } = makePkcePair();
  const code = await getAuthorizationCode({ username: "oauth-usera", password: "TestPass123!", codeChallenge });
  const token = (await exchangeCodeForTokens({ code, codeVerifier })).body;

  const revokeRealRes = await request(app).post("/oauth/revoke").type("form").send({ token: token.refresh_token });
  assert.equal(revokeRealRes.status, 200);

  const revokeFakeRes = await request(app).post("/oauth/revoke").type("form").send({ token: "not-a-real-token" });
  assert.equal(revokeFakeRes.status, 200);

  const refreshAfterRevoke = await request(app).post("/oauth/token").type("form").send({
    grant_type: "refresh_token",
    client_id: MCP_OAUTH_CLIENT_ID,
    refresh_token: token.refresh_token
  });
  assert.equal(refreshAfterRevoke.status, 400);
});

test("well-known discovery documents point at the right endpoints", async () => {
  const authServerRes = await request(app).get("/.well-known/oauth-authorization-server");
  assert.equal(authServerRes.status, 200);
  assert.match(authServerRes.body.authorization_endpoint, /\/oauth\/authorize$/);
  assert.match(authServerRes.body.token_endpoint, /\/oauth\/token$/);

  const resourceRes = await request(app).get("/.well-known/oauth-protected-resource");
  assert.equal(resourceRes.status, 200);
  assert.match(resourceRes.body.resource, /\/mcp$/);
});
