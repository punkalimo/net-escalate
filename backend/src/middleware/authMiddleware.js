import { verifyAuthToken, AUTH_COOKIE_NAME } from "../services/authService.js";

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
export function requireLevel(minLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required." });
    if (Number(req.user.level) < minLevel) {
      return res.status(403).json({ success: false, message: `This action requires level ${minLevel} or more senior (you are level ${req.user.level}).` });
    }
    return next();
  };
}

export default { requireAuth, requireLevel };
