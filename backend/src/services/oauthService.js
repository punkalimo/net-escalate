// OAuth 2.0 Authorization Code + PKCE flow backing the remote MCP bridge
// (oauthRoutes.js -> mcpRoutes.js) - see docs/WEBMCP.md's "Remote MCP +
// OAuth" section for why this exists: ChatGPT's Developer Mode connectors
// only accept a public HTTPS MCP server with OAuth, never a local/stdio
// server, unlike Claude Desktop/Code/Cursor/Windsurf (which use
// @mcp-b/webmcp-local-relay instead - a completely separate, simpler path
// that doesn't need any of this).
//
// This is intentionally a SINGLE-CLIENT OAuth server, not a general-purpose
// multi-tenant one: one statically configured client_id/redirect_uri
// allowlist (env vars below), no Dynamic Client Registration (RFC 7591).
// That's a deliberate scope decision, not an oversight - see the plan this
// was built from.
import crypto from "crypto";
import { signMcpAccessToken, MCP_ACCESS_TOKEN_TTL_SECONDS } from "./authService.js";
import OAuthAuthorizationCode from "../models/OAuthAuthorizationCode.js";
import OAuthRefreshToken from "../models/OAuthRefreshToken.js";

const AUTH_CODE_TTL_SECONDS = 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const MCP_OAUTH_CLIENT_ID = process.env.MCP_OAUTH_CLIENT_ID || "chatgpt-connector";
// Confidential-client secret is OPTIONAL: PKCE alone is a sufficient public-
// client protection (this is what Claude/Cursor's own OAuth flows rely on
// too). If MCP_OAUTH_CLIENT_SECRET is set, the token endpoint additionally
// requires it - operator's choice, not a hardcoded requirement.
const MCP_OAUTH_CLIENT_SECRET = process.env.MCP_OAUTH_CLIENT_SECRET || null;
const ALLOWED_REDIRECT_URIS = new Set(
  String(process.env.MCP_OAUTH_REDIRECT_URIS || "")
    .split(",")
    .map(uri => uri.trim())
    .filter(Boolean)
);

export function isRedirectUriAllowed(redirectUri) {
  return ALLOWED_REDIRECT_URIS.has(String(redirectUri || "").trim());
}

export function validateClient({ clientId, clientSecret }) {
  if (clientId !== MCP_OAUTH_CLIENT_ID) return false;
  if (MCP_OAUTH_CLIENT_SECRET && clientSecret !== MCP_OAUTH_CLIENT_SECRET) return false;
  return true;
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

function hashToken(token) {
  // A stored lookup key, not a password - a fast, deterministic SHA-256 is
  // the right tool here (bcrypt is for secrets an attacker can brute-force
  // offline at low entropy; these are 256-bit random tokens, brute-forcing
  // the hash is infeasible regardless of hash speed, and we need to look
  // rows up by exact hash match, which bcrypt's per-call salt prevents).
  return crypto.createHash("sha256").update(token).digest("hex");
}

// PKCE (RFC 7636), S256 only - see OAuthAuthorizationCode.js.
export function verifyPkce(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  return computed === codeChallenge;
}

// Called from GET/POST /oauth/authorize once a technician has logged in and
// clicked "Allow" on the consent screen. realmId is whatever oauthRoutes.js
// resolved BEFORE calling this - this function never re-derives it, exactly
// like createManualIncident() etc. never re-derive realmId from the request.
export async function issueAuthorizationCode({ technicianId, realmId, clientId, redirectUri, codeChallenge, scope = "read" }) {
  const code = randomToken();
  await OAuthAuthorizationCode.create({
    codeHash: hashToken(code),
    technicianId,
    realmId,
    clientId,
    redirectUri,
    codeChallenge,
    scope,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000)
  });
  return code;
}

// POST /oauth/token, grant_type=authorization_code. Single-use: the matched
// document is atomically marked used in the same query that finds it, so a
// concurrent double-redeem (e.g. a retried request) can't both succeed.
export async function redeemAuthorizationCode({ code, clientId, redirectUri, codeVerifier }) {
  const record = await OAuthAuthorizationCode.findOneAndUpdate(
    { codeHash: hashToken(code), used: false },
    { $set: { used: true } }
  );
  if (!record) throw new OAuthError("invalid_grant", "Authorization code is invalid, expired, or already used.");
  if (record.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "Authorization code has expired.");
  if (record.clientId !== clientId) throw new OAuthError("invalid_grant", "Authorization code was not issued to this client.");
  if (record.redirectUri !== redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match the one used to request this code.");
  if (!verifyPkce(codeVerifier, record.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE code_verifier does not match.");

  return { technicianId: record.technicianId, realmId: record.realmId, scope: record.scope };
}

export async function issueTokenPair({ technicianId, realmId, clientId, scope = "read" }) {
  const accessToken = signMcpAccessToken({ technicianId, realmId, clientId, scope });
  const refreshToken = randomToken();
  await OAuthRefreshToken.create({
    tokenHash: hashToken(refreshToken),
    technicianId,
    realmId,
    clientId,
    scope,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  });
  return { accessToken, refreshToken, expiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS, scope };
}

// POST /oauth/token, grant_type=refresh_token. Rotates on every use (the old
// token is revoked, never just re-returned) so a leaked-then-replayed
// refresh token is detectable: a legitimate client's next real refresh will
// find its token already revoked and can alert/re-auth rather than silently
// racing an attacker for the same token.
export async function rotateRefreshToken({ refreshToken, clientId }) {
  const record = await OAuthRefreshToken.findOneAndUpdate(
    { tokenHash: hashToken(refreshToken), revoked: false },
    { $set: { revoked: true } }
  );
  if (!record) throw new OAuthError("invalid_grant", "Refresh token is invalid, expired, or already revoked.");
  if (record.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "Refresh token has expired.");
  if (record.clientId !== clientId) throw new OAuthError("invalid_grant", "Refresh token was not issued to this client.");

  return issueTokenPair({ technicianId: record.technicianId, realmId: record.realmId, clientId, scope: record.scope });
}

export async function revokeRefreshToken({ refreshToken }) {
  await OAuthRefreshToken.updateOne({ tokenHash: hashToken(refreshToken) }, { $set: { revoked: true } });
}

export class OAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.oauthErrorCode = code; // maps directly to RFC 6749 §5.2 error codes
  }
}

export default {
  MCP_OAUTH_CLIENT_ID, isRedirectUriAllowed, validateClient, verifyPkce,
  issueAuthorizationCode, redeemAuthorizationCode, issueTokenPair, rotateRefreshToken, revokeRefreshToken,
  OAuthError
};
