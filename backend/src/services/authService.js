import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h - matches the cookie maxAge set on login.
export const AUTH_COOKIE_NAME = "netescalate_token";
export const AUTH_COOKIE_MAX_AGE_MS = TOKEN_TTL_SECONDS * 1000;

// Enter Realm context - a SEPARATE, short-lived token/cookie from the main
// identity token above. Deliberately not a re-issue of the identity JWT:
// "who you are" (platform admin) and "what realm you're currently viewing"
// are independent, so exiting a realm never requires logging back in, and
// the identity token's own 12h expiry is unaffected by how long a support
// session lasts.
const REALM_CONTEXT_TTL_SECONDS = 2 * 60 * 60; // 2h - a support session shouldn't silently linger all day.
export const REALM_CONTEXT_COOKIE_NAME = "netescalate_realm_context";
export const REALM_CONTEXT_COOKIE_MAX_AGE_MS = REALM_CONTEXT_TTL_SECONDS * 1000;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not configured. Set it in backend/.env before starting the server.");
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

// Payload deliberately excludes passwordHash - only what routes/UI need to
// identify and authorize the caller. phone is included (not a secret, and
// the "My Profile" self-edit screen needs to show/prefill it) unlike
// passwordHash. realmId/realmRole are only present for a normal realm
// technician; platformRole is only present for a platform-level operator
// (realmId is null for them - see Technician.js).
export function signAuthToken(technician, { realmName = null } = {}) {
  return jwt.sign(
    {
      technicianId: technician.technicianId,
      username: technician.username,
      name: technician.name,
      phone: technician.phone || null,
      role: technician.role,
      level: technician.level,
      realmId: technician.realmId ? String(technician.realmId) : null,
      realmName,
      realmRole: technician.realmRole || null,
      platformRole: technician.platformRole || null
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

export function verifyAuthToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function signRealmContext({ realmId, realmName, enteredBy }) {
  return jwt.sign({ realmId: String(realmId), realmName, enteredBy, enteredAt: new Date().toISOString() }, JWT_SECRET, { expiresIn: REALM_CONTEXT_TTL_SECONDS });
}

export function verifyRealmContext(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Bearer token for the remote MCP + OAuth bridge (oauthService.js,
// mcpAuthMiddleware.js - see docs/WEBMCP.md's "Remote MCP + OAuth" section).
// A SEPARATE token kind from the session cookie's JWT above, even though
// both are signed with the same JWT_SECRET: the `typ` claim is checked on
// verify specifically so an mcp_access token can never be replayed as a
// session cookie (or vice versa) even if one were somehow smuggled into the
// wrong header/cookie. realmId is fixed at OAuth consent time and is never
// re-derived from anything the caller supplies afterward - the remote-MCP
// equivalent of attachRealmScope never trusting a client-supplied realmId.
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h

export function signMcpAccessToken({ technicianId, realmId, clientId, scope }) {
  return jwt.sign(
    { typ: "mcp_access", technicianId, realmId: String(realmId), clientId, scope },
    JWT_SECRET,
    { expiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS }
  );
}

export function verifyMcpAccessToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.typ !== "mcp_access") throw new Error("Not an MCP access token.");
  return payload;
}

export default {
  hashPassword, verifyPassword, signAuthToken, verifyAuthToken, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS,
  signRealmContext, verifyRealmContext, REALM_CONTEXT_COOKIE_NAME, REALM_CONTEXT_COOKIE_MAX_AGE_MS,
  signMcpAccessToken, verifyMcpAccessToken, MCP_ACCESS_TOKEN_TTL_SECONDS
};
