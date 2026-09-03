import express from "express";
import Technician from "../models/Technician.js";
import Realm from "../models/Realm.js";
import { verifyPassword, hashPassword, signAuthToken, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS } from "../services/authService.js";
import { requireAuth, attachRealmScope } from "../middleware/authMiddleware.js";
import { logAudit } from "../services/auditLogService.js";

// The frontend and API are on different Render origins. In production the
// session cookie therefore needs cross-origin SameSite=None semantics and
// Secure=true. httpOnly keeps the JWT inaccessible to browser JavaScript.
// The localhost branch remains convenient for local development over HTTP.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: IS_PRODUCTION ? "none" : "lax",
  secure: IS_PRODUCTION,
  maxAge: AUTH_COOKIE_MAX_AGE_MS
};

async function buildUserPayload(technician) {
  const realm = technician.realmId ? await Realm.findById(technician.realmId).select("name").lean() : null;
  return { technicianId: technician.technicianId, username: technician.username, name: technician.name, phone: technician.phone || null, role: technician.role, level: technician.level, realmId: technician.realmId ? String(technician.realmId) : null, realmName: realm?.name || null, realmRole: technician.realmRole || null, platformRole: technician.platformRole || null };
}

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

      const user = await buildUserPayload(technician);
      const token = signAuthToken(technician, { realmName: user.realmName });
      res.cookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
      await logAudit({ actor: user, realmId: user.realmId, targetType: "Technician", targetId: technician.technicianId, action: "LOGIN", req });
      return res.json({ success: true, user });
    } catch (error) {
      console.error("LOGIN ERROR:", error);
      return res.status(500).json({ success: false, message: "Login failed.", error: error.message });
    }
  });

  router.post("/logout", (req, res) => {
    logAudit({ actor: req.user || null, targetType: "Technician", targetId: req.user?.technicianId, action: "LOGOUT", req });
    res.clearCookie(AUTH_COOKIE_NAME, { httpOnly: true, sameSite: IS_PRODUCTION ? "none" : "lax", secure: IS_PRODUCTION });
    return res.json({ success: true });
  });

  router.get("/me", requireAuth, attachRealmScope, (req, res) => {
    return res.json({ success: true, user: { ...req.user, enteredRealm: req.realmContext || null } });
  });

  router.patch("/me", requireAuth, async (req, res) => {
    try {
      const updates = {};
      for (const field of ["name", "phone"]) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
      }
      const technician = await Technician.findOneAndUpdate({ technicianId: req.user.technicianId }, { $set: updates }, { new: true, runValidators: true });
      if (!technician) return res.status(404).json({ success: false, message: "Account not found." });

      const user = await buildUserPayload(technician);
      const token = signAuthToken(technician, { realmName: user.realmName });
      res.cookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
      await logAudit({ actor: user, realmId: user.realmId, targetType: "Technician", targetId: technician.technicianId, action: "SELF_PROFILE_UPDATED", metadata: updates, req });
      return res.json({ success: true, user });
    } catch (error) {
      console.error("UPDATE MY PROFILE ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to update your profile." });
    }
  });

  router.post("/me/credentials", requireAuth, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newUsername = req.body?.newUsername != null ? String(req.body.newUsername).trim().toLowerCase() : null;
      const newPassword = req.body?.newPassword != null ? String(req.body.newPassword) : null;

      const technician = await Technician.findOne({ technicianId: req.user.technicianId });
      if (!technician) return res.status(404).json({ success: false, message: "Account not found." });
      if (!await verifyPassword(currentPassword, technician.passwordHash)) return res.status(400).json({ success: false, message: "Current password is incorrect." });

      if (newUsername) technician.username = newUsername;
      if (newPassword) {
        if (newPassword.length < 8) return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
        technician.passwordHash = await hashPassword(newPassword);
      }
      await technician.save();

      const user = await buildUserPayload(technician);
      const token = signAuthToken(technician, { realmName: user.realmName });
      res.cookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
      await logAudit({ actor: user, realmId: user.realmId, targetType: "Technician", targetId: technician.technicianId, action: "SELF_CREDENTIALS_CHANGED", req });
      return res.json({ success: true, user });
    } catch (error) {
      console.error("UPDATE MY CREDENTIALS ERROR:", error);
      const duplicate = error?.code === 11000;
      return res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "That username is already taken." : "Failed to update your credentials." });
    }
  });

  return router;
}
