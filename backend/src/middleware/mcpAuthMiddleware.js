import { verifyMcpAccessToken } from "../services/authService.js";

// Bearer-token auth for the remote MCP server (mcpRoutes.js) - the OAuth
// equivalent of requireAuth+attachRealmScope in authMiddleware.js, but for a
// request with no session cookie at all (ChatGPT/any remote MCP client sends
// `Authorization: Bearer <mcp_access token>` instead).
//
// req.realmId comes straight from the token's claims - it was fixed once, at
// /oauth/authorize consent time (oauthRoutes.js), and is never re-derived
// from anything in this request. Same rule as attachRealmScope.js, applied
// to a stateless token instead of a cookie session.
export function requireMcpAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.set("WWW-Authenticate", 'Bearer realm="netescalate-mcp", error="invalid_token"');
    return res.status(401).json({ success: false, error: { code: "AUTHENTICATION_REQUIRED", message: "A Bearer access token is required." } });
  }

  try {
    const payload = verifyMcpAccessToken(token);
    req.technicianId = payload.technicianId;
    req.realmId = payload.realmId;
    req.mcpScope = payload.scope;
    req.mcpClientId = payload.clientId;
    // logToolInvocation (webmcpService.js) reads req.user for the audit
    // trail's actor fields - a minimal stand-in is enough (optional-chained
    // on the read side in auditLogService.js), so both the cookie-authed
    // browser path and this Bearer-authed path log through the same helper
    // unchanged.
    req.user = { technicianId: payload.technicianId };
    return next();
  } catch (error) {
    res.set("WWW-Authenticate", 'Bearer realm="netescalate-mcp", error="invalid_token"');
    return res.status(401).json({ success: false, error: { code: "INVALID_TOKEN", message: "Access token is invalid or expired." } });
  }
}

export default { requireMcpAuth };
