import express from "express";
import Technician from "../models/Technician.js";
import Realm from "../models/Realm.js";
import { verifyPassword, signAuthToken, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS } from "../services/authService.js";
import { requireAuth, attachRealmScope } from "../middleware/authMiddleware.js";
import { logAudit } from "../services/auditLogService.js";

// httpOnly cookie, not a token the frontend reads/stores itself: avoids
// exposing the session token to XSS on this React app, at the cost of
// needing CORS credentials + a matching frontend axios/socket.io
// withCredentials (see server.js and frontend/src/services/api.js).
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: AUTH_COOKIE_MAX_AGE_MS
};

export default function authRoutes() {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!username || !password) return res.status(400).json({ success: false, message: "Username and password are required." });

      const technician = await Technician.findOne({ username, active: true });
      const valid = technician && await verifyPassword(password, technician.passwordHash);
      if (!valid) {
        await logAudit({ actor: null, targetType: "Technician", targetId: username, action: "LOGIN_FAILED", req });
        return res.status(401).json({ success: false, message: "Invalid username or password." });
      }

      const realm = technician.realmId ? await Realm.findById(technician.realmId).select("name").lean() : null;
      const token = signAuthToken(technician, { realmName: realm?.name || null });
      res.cookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
      const user = { technicianId: technician.technicianId, username: technician.username, name: technician.name, role: technician.role, level: technician.level, realmId: technician.realmId ? String(technician.realmId) : null, realmName: realm?.name || null, realmRole: technician.realmRole || null, platformRole: technician.platformRole || null };
      await logAudit({ actor: user, realmId: user.realmId, targetType: "Technician", targetId: technician.technicianId, action: "LOGIN", req });
      return res.json({ success: true, user });
    } catch (error) {
      console.error("LOGIN ERROR:", error);
      return res.status(500).json({ success: false, message: "Login failed.", error: error.message });
    }
  });

  router.post("/logout", (req, res) => {
    logAudit({ actor: req.user || null, targetType: "Technician", targetId: req.user?.technicianId, action: "LOGOUT", req });
    res.clearCookie(AUTH_COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return res.json({ success: true });
  });

  router.get("/me", requireAuth, attachRealmScope, (req, res) => {
    return res.json({ success: true, user: { ...req.user, enteredRealm: req.realmContext || null } });
  });

  return router;
}
