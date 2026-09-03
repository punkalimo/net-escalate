// OAuth 2.0 Authorization Code + PKCE endpoints backing the remote MCP
// bridge (see docs/WEBMCP.md's "Remote MCP + OAuth" section, and
// oauthService.js for the token/code logic this file is a thin HTTP layer
// over). Server-rendered plain HTML - no React needed for a two-field login
// form and a one-button consent screen.
import express from "express";
import Technician from "../models/Technician.js";
import Realm from "../models/Realm.js";
import { verifyPassword } from "../services/authService.js";
import {
  MCP_OAUTH_CLIENT_ID, isRedirectUriAllowed, validateClient, issueAuthorizationCode,
  redeemAuthorizationCode, issueTokenPair, rotateRefreshToken, revokeRefreshToken, OAuthError
} from "../services/oauthService.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function page({ title, body }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0b0b13;color:#e6e6f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#15151f;border:1px solid #2a2a3a;border-radius:12px;padding:32px;max-width:380px;width:90%}
h1{font-size:18px;margin:0 0 4px}
p.sub{color:#9a9ab0;font-size:13px;margin:0 0 20px}
label{display:block;font-size:13px;color:#b8b8c8;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #35354a;background:#0f0f18;color:#e6e6f0;font-size:14px}
button{width:100%;margin-top:20px;padding:11px;border-radius:8px;border:none;background:#6b4bff;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.error{background:#3a1520;border:1px solid #7a2a3a;color:#ff9ab0;padding:10px;border-radius:8px;font-size:13px;margin-top:12px}
.scope{background:#0f0f18;border:1px solid #2a2a3a;border-radius:8px;padding:12px;font-size:13px;color:#c8c8d8;margin-top:8px}
.scope ul{margin:6px 0 0;padding-left:18px}
</style></head><body><div class="card">${body}</div></body></html>`;
}

function hiddenFields(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n");
}

function authorizeForm({ oauthParams, realms = null, error = null }) {
  return page({
    title: "Sign in to NetEscalate",
    body: `
      <h1>NetEscalate</h1>
      <p class="sub">A connector wants read-only access to your NetEscalate data.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <form method="POST" action="/oauth/authorize">
        ${hiddenFields(oauthParams)}
        <label>Username</label>
        <input type="text" name="username" autocomplete="username" required>
        <label>Password</label>
        <input type="password" name="password" autocomplete="current-password" required>
        ${realms ? `
        <label>Realm to grant access to</label>
        <select name="realmId" required>
          ${realms.map(r => `<option value="${escapeHtml(r._id)}">${escapeHtml(r.name)}</option>`).join("")}
        </select>` : ""}
        <div class="scope">This connector will be able to:
          <ul><li>Search devices and view health/interfaces</li><li>View incidents and run investigations</li><li>View technicians</li></ul>
          It will NOT be able to create incidents, assign technicians, or add notes.
        </div>
        <button type="submit">Sign in &amp; Authorize</button>
      </form>`
  });
}

// Query/body params common to GET and POST /oauth/authorize.
function readOAuthParams(source) {
  return {
    response_type: source.response_type,
    client_id: source.client_id,
    redirect_uri: source.redirect_uri,
    code_challenge: source.code_challenge,
    code_challenge_method: source.code_challenge_method,
    scope: source.scope || "read",
    state: source.state
  };
}

function validateAuthorizeRequest(oauthParams) {
  if (oauthParams.response_type !== "code") return "Only response_type=code is supported.";
  if (!validateClient({ clientId: oauthParams.client_id, clientSecret: null })) return "Unknown client_id.";
  if (!isRedirectUriAllowed(oauthParams.redirect_uri)) return "redirect_uri is not registered for this client.";
  if (oauthParams.code_challenge_method !== "S256") return "Only code_challenge_method=S256 is supported.";
  if (!oauthParams.code_challenge) return "code_challenge is required.";
  return null;
}

export default function oauthRoutes() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  router.get("/authorize", (req, res) => {
    const oauthParams = readOAuthParams(req.query);
    const validationError = validateAuthorizeRequest(oauthParams);
    if (validationError) return res.status(400).send(page({ title: "Invalid request", body: `<h1>Invalid request</h1><p class="sub">${escapeHtml(validationError)}</p>` }));
    return res.send(authorizeForm({ oauthParams }));
  });

  router.post("/authorize", async (req, res) => {
    const oauthParams = readOAuthParams(req.body);
    const validationError = validateAuthorizeRequest(oauthParams);
    if (validationError) return res.status(400).send(page({ title: "Invalid request", body: `<h1>Invalid request</h1><p class="sub">${escapeHtml(validationError)}</p>` }));

    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const technician = await Technician.findOne({ username, active: true });
    const valid = technician && await verifyPassword(password, technician.passwordHash);
    if (!valid) return res.status(401).send(authorizeForm({ oauthParams, error: "Invalid username or password." }));

    let realmId;
    if (technician.platformRole) {
      const chosenRealmId = String(req.body?.realmId || "");
      const realm = chosenRealmId ? await Realm.findOne({ _id: chosenRealmId, status: "active" }).lean() : null;
      if (!realm) {
        const realms = await Realm.find({ status: "active" }).select("name").sort({ name: 1 }).lean();
        return res.status(400).send(authorizeForm({ oauthParams, realms, error: "Choose a realm to grant access to." }));
      }
      realmId = realm._id;
    } else {
      if (!technician.realmId) return res.status(400).send(authorizeForm({ oauthParams, error: "Your account is not assigned to a realm." }));
      realmId = technician.realmId;
    }

    const code = await issueAuthorizationCode({
      technicianId: technician.technicianId,
      realmId,
      clientId: oauthParams.client_id,
      redirectUri: oauthParams.redirect_uri,
      codeChallenge: oauthParams.code_challenge,
      scope: oauthParams.scope
    });

    const redirectUrl = new URL(oauthParams.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (oauthParams.state) redirectUrl.searchParams.set("state", oauthParams.state);
    return res.redirect(redirectUrl.toString());
  });

  router.post("/token", async (req, res) => {
    const grantType = req.body?.grant_type;
    const clientId = req.body?.client_id;
    const clientSecret = req.body?.client_secret;
    if (!validateClient({ clientId, clientSecret })) {
      return res.status(401).json({ error: "invalid_client", error_description: "Unknown client_id or invalid client_secret." });
    }

    try {
      let granted;
      if (grantType === "authorization_code") {
        const { technicianId, realmId, scope } = await redeemAuthorizationCode({
          code: req.body?.code,
          clientId,
          redirectUri: req.body?.redirect_uri,
          codeVerifier: req.body?.code_verifier
        });
        granted = await issueTokenPair({ technicianId, realmId, clientId, scope });
      } else if (grantType === "refresh_token") {
        granted = await rotateRefreshToken({ refreshToken: req.body?.refresh_token, clientId });
      } else {
        return res.status(400).json({ error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported." });
      }

      return res.json({
        access_token: granted.accessToken,
        token_type: "Bearer",
        expires_in: granted.expiresIn,
        refresh_token: granted.refreshToken,
        scope: granted.scope
      });
    } catch (error) {
      if (error instanceof OAuthError) return res.status(400).json({ error: error.oauthErrorCode, error_description: error.message });
      console.error("OAUTH /token ERROR:", error);
      return res.status(500).json({ error: "server_error", error_description: "Token exchange failed." });
    }
  });

  router.post("/revoke", async (req, res) => {
    // RFC 7009 - always 200, regardless of whether the token existed, to
    // avoid using this endpoint as a token-validity oracle.
    if (req.body?.token) await revokeRefreshToken({ refreshToken: req.body.token });
    return res.status(200).json({ success: true });
  });

  return router;
}

// RFC 8414 authorization server metadata + RFC 9728 protected resource
// metadata - mounted at the server root's /.well-known/* in server.js (the
// well-known URI convention, RFC 8615, requires these at the root, not
// nested under /oauth). Lets a spec-compliant MCP client (ChatGPT included)
// discover these endpoints from just the /mcp URL, rather than requiring the
// user to hand-type every OAuth URL into a connector setup form.
export function wellKnownRoutes() {
  const router = express.Router();

  router.get("/oauth-authorization-server", (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
    });
  });

  router.get("/oauth-protected-resource", (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["read"],
      bearer_methods_supported: ["header"]
    });
  });

  return router;
}

export { MCP_OAUTH_CLIENT_ID };
