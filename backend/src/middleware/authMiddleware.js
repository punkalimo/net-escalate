import { verifyAuthToken, AUTH_COOKIE_NAME, verifyRealmContext, REALM_CONTEXT_COOKIE_NAME } from "../services/authService.js";

// Reads the JWT from the httpOnly cookie set at login (not an Authorization
// header - see authRoutes.js's comment on why a cookie was chosen), verifies
// it, and attaches the decoded payload as req.user. Every /api/* route
// except /api/health and /api/auth/login goes through this - see server.js.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) return res.status(401).json({ success: false, message: "Authentication required." });

  try {
    req.user = verifyAuthToken(token);
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired session." });
  }
}

// For approve/execute on a HIGH RISK remediation action - the one place so
// far where a specific escalation level, not just "logged in," matters.
// Technician.level follows the same meaning it has everywhere else in this
// codebase (escalationSweepService.js, incidentService.js): level increases
// with seniority as an incident escalates, e.g. Level 1 is first-line,
// Level 3 is the senior/on-call engineer.
// A platform admin has no `level` at all (they aren't part of any
// escalation chain), so they explicitly bypass this check rather than
// accidentally passing (Number(undefined) < minLevel is NaN < minLevel,
// which is always false - relying on that quirk would be fragile and
// unintentional-looking). This only matters while they're acting inside an
// Enter Realm context (attachRealmScope has already given them a real
// req.realmId there) - e.g. the Realm Setup Wizard creating that realm's
// first technician.
export function requireLevel(minLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
    if (req.user.platformRole) return next();
    if (Number(req.user.level) < minLevel) {
      return res.status(403).json({ success: false, message: `This action requires level ${minLevel} or more senior (you are level ${req.user.level}).` });
    }
    return next();
  };
}

// 403s unless the caller is a platform-level operator (platformRole set on
// their JWT - see Technician.js/authService.js). Modeled directly on
// requireLevel, but this is a wholly separate authority axis, not a more
// senior "level" - a platform admin isn't part of any realm's escalation
// chain at all.
export function requirePlatform(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
  if (!req.user.platformRole) return res.status(403).json({ success: false, message: "This action requires a platform-level account." });
  return next();
}

// Computes req.realmId (and, for a platform admin, req.realmContext) for
// every tenant-scoped route to filter its queries by. This is the ONLY
// place realm scope is derived from the request - route handlers must use
// req.realmId, never a client-supplied realmId/query param, or tenant
// isolation silently breaks (see the plan's §4 "do not trust ?realmId=").
//
//   - Normal realm technician -> req.user.realmId (set at login).
//   - Platform admin with an active Enter Realm context cookie -> that
//     realm's id, plus req.realmContext for the frontend banner/audit trail.
//   - Platform admin with no entered realm -> req.realmId = null. This is
//     deliberate, not a bug: every tenant-owned collection now requires a
//     real realmId, so a null-scoped query matches nothing - a platform
//     admin gets empty results on the normal realm-scoped routes until they
//     explicitly Enter a realm, rather than ever implicitly seeing
//     cross-realm data through those endpoints.
export function attachRealmScope(req, res, next) {
  if (req.user?.platformRole) {
    const contextToken = req.cookies?.[REALM_CONTEXT_COOKIE_NAME];
    if (contextToken) {
      try {
        const context = verifyRealmContext(contextToken);
        req.realmId = context.realmId;
        req.realmContext = context;
        return next();
      } catch (error) {
        // Expired/invalid context - fall through to "no realm entered"
        // rather than 401ing the whole request; the platform admin is
        // still validly authenticated, just no longer scoped to a realm.
      }
    }
    req.realmId = null;
    req.realmContext = null;
    return next();
  }

  req.realmId = req.user?.realmId || null;
  return next();
}

export default { requireAuth, requireLevel, requirePlatform, attachRealmScope };
