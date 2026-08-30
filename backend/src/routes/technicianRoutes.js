import express from "express";
import Technician from "../models/Technician.js";
import { callTechnician, getCallCapability } from "../services/calleService.js";
import { hashPassword } from "../services/authService.js";
import { requireRealmManager } from "../middleware/authMiddleware.js";
import { logAudit } from "../services/auditLogService.js";
import { computeTechnicianPerformance } from "../services/technicianPerformanceService.js";

const router = express.Router();

// Reuse the schema's own enum rather than hardcoding a second list that
// could drift out of sync with Technician.js.
const REALM_ROLE_VALUES = Technician.schema.path("realmRole").enumValues;

// Only an existing realm_owner (or a platform admin, who bypasses
// requireRealmManager entirely) may grant realmRole "realm_owner" to
// someone else - otherwise any realm_admin/senior_engineer could mint
// themselves or a peer a co-owner, which is meant to be a singular,
// deliberately-granted designation.
function canGrantRealmOwner(actor) {
  return Boolean(actor?.platformRole) || actor?.realmRole === "realm_owner";
}

router.get("/", async (req, res) => {
  try {
    const technicians = await Technician.find({ realmId: req.realmId }).sort({ level: 1, name: 1 });
    res.json({ success: true, technicians });
  } catch (error) {
    console.error("Get technicians error:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve technicians." });
  }
});

// Only a realm manager (realm_owner/realm_admin/noc_manager/senior_engineer,
// or a platform admin) can add new escalation contacts - see the "Add
// technician" gating in the Escalation Team panel.
router.post("/", requireRealmManager, async (req, res) => {
  try {
    const { technicianId, name, phone, level, role, active = true, realmRole } = req.body;
    if (!technicianId || !name || !phone || !level) return res.status(400).json({ success: false, message: "Technician ID, name, phone and level are required." });
    if (realmRole != null) {
      if (!REALM_ROLE_VALUES.includes(realmRole)) return res.status(400).json({ success: false, message: "Invalid realm role." });
      if (realmRole === "realm_owner" && !canGrantRealmOwner(req.user)) return res.status(403).json({ success: false, message: "Only a realm owner can grant the realm owner role." });
    }
    const technician = await Technician.create({ technicianId, realmId: req.realmId, name, phone, level: Number(level), role, active, ...(realmRole != null ? { realmRole } : {}) });
    await logAudit({ actor: req.user, realmId: req.realmId, targetType: "Technician", targetId: technician.technicianId, action: "TECHNICIAN_CREATED", req });
    res.status(201).json({ success: true, technician });
  } catch (error) {
    console.error("Create technician error:", error);
    const duplicate = error?.code === 11000;
    res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "Technician ID already exists." : "Failed to create technician." });
  }
});

// Grants or resets a technician's dashboard login. Realm-manager only, same
// as creating a technician - this is the in-app replacement for the
// create-admin.mjs bootstrap script for day-to-day use (new hire, or
// someone forgot their password).
router.post("/:technicianId/credentials", requireRealmManager, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!username || password.length < 8) return res.status(400).json({ success: false, message: "Username and an at-least-8-character password are required." });

    const technician = await Technician.findOne({ technicianId: req.params.technicianId, realmId: req.realmId });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });

    technician.username = username;
    technician.passwordHash = await hashPassword(password);
    await technician.save();
    await logAudit({ actor: req.user, realmId: req.realmId, targetType: "Technician", targetId: technician.technicianId, action: "TECHNICIAN_CREDENTIALS_RESET", req });
    res.json({ success: true, technician });
  } catch (error) {
    console.error("Set technician credentials error:", error);
    const duplicate = error?.code === 11000;
    res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "That username is already taken." : "Failed to set login credentials." });
  }
});

// Explicit whitelist, not a raw ...req.body spread: Technician now also
// carries realmId/realmRole/platformRole/username/passwordHash, and a naive
// spread would let a request body silently reassign its own realm, grant
// itself a platform role, or overwrite the password hash directly. Only
// these contact/escalation fields are updatable through this route -
// realmRole changes and credentials go through their own dedicated,
// manager-gated paths.
const PATCHABLE_FIELDS = ["name", "phone", "level", "role", "active"];

router.patch("/:technicianId", requireRealmManager, async (req, res) => {
  try {
    const updates = {};
    for (const field of PATCHABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = field === "level" ? Number(req.body.level) : req.body[field];
    }
    const technician = await Technician.findOneAndUpdate({ technicianId: req.params.technicianId, realmId: req.realmId }, { $set: updates }, { new: true, runValidators: true });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    await logAudit({ actor: req.user, realmId: req.realmId, targetType: "Technician", targetId: technician.technicianId, action: "TECHNICIAN_UPDATED", metadata: updates, req });
    res.json({ success: true, technician });
  } catch (error) {
    console.error("Update technician error:", error);
    res.status(500).json({ success: false, message: "Failed to update technician." });
  }
});

// Dedicated, manager-gated path for realmRole changes - kept separate from
// the general PATCH above (see its comment) so a body spread there can never
// silently grant a role, and so the realm_owner-grant guard below has one
// single enforcement point.
router.patch("/:technicianId/role", requireRealmManager, async (req, res) => {
  try {
    const { realmRole } = req.body || {};
    if (!REALM_ROLE_VALUES.includes(realmRole)) return res.status(400).json({ success: false, message: "Invalid realm role." });
    if (realmRole === "realm_owner" && !canGrantRealmOwner(req.user)) return res.status(403).json({ success: false, message: "Only a realm owner can grant the realm owner role." });

    const technician = await Technician.findOneAndUpdate({ technicianId: req.params.technicianId, realmId: req.realmId }, { $set: { realmRole } }, { new: true, runValidators: true });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    await logAudit({ actor: req.user, realmId: req.realmId, targetType: "Technician", targetId: technician.technicianId, action: "TECHNICIAN_ROLE_CHANGED", metadata: { realmRole }, req });
    res.json({ success: true, technician });
  } catch (error) {
    console.error("Update technician role error:", error);
    res.status(500).json({ success: false, message: "Failed to update technician role." });
  }
});

router.delete("/:technicianId", requireRealmManager, async (req, res) => {
  try {
    const technician = await Technician.findOneAndDelete({ technicianId: req.params.technicianId, realmId: req.realmId });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    await logAudit({ actor: req.user, realmId: req.realmId, targetType: "Technician", targetId: req.params.technicianId, action: "TECHNICIAN_DELETED", req });
    res.json({ success: true, technicianId: req.params.technicianId });
  } catch (error) {
    console.error("Delete technician error:", error);
    res.status(500).json({ success: false, message: "Failed to delete technician." });
  }
});

// Team-wide performance rollup - see technicianPerformanceService.js. Placed
// before no conflicting bare "/:technicianId" route exists, so this literal
// "/performance" segment is unambiguous.
router.get("/performance", requireRealmManager, async (req, res) => {
  try {
    const performance = await computeTechnicianPerformance({ realmId: req.realmId });
    res.json({ success: true, performance });
  } catch (error) {
    console.error("Get technician performance error:", error);
    res.status(500).json({ success: false, message: "Failed to compute technician performance." });
  }
});

router.get("/:technicianId/capability", async (req, res) => {
  try {
    const technician = await Technician.findOne({ technicianId: req.params.technicianId, realmId: req.realmId });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    res.json({ success: true, capability: getCallCapability(technician.phone) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to determine CALL-E capability." });
  }
});

router.post("/:technicianId/test-call", async (req, res) => {
  try {
    const technician = await Technician.findOne({ technicianId: req.params.technicianId, realmId: req.realmId, active: true });
    if (!technician) return res.status(404).json({ success: false, message: "Active technician not found." });
    const capability = getCallCapability(technician.phone);
    if (capability.state === "UNSUPPORTED") return res.status(422).json({ success: false, provider: "calle", code: capability.code, capability, message: capability.message });
    const testIncident = {
      incidentId: `TEST-CALL-${Date.now()}`,
      escalationLevel: Number(technician.level || 1),
      severity: "low",
      device: req.body?.device || "CALL-E TEST",
      location: req.body?.location || "NetEscalate test",
      description: req.body?.description || "This is a controlled NetEscalate CALL-E connectivity test. Confirm that you can receive and accept the test escalation.",
      technician: { id: technician.technicianId, name: technician.name, phone: technician.phone }
    };
    const result = await callTechnician(testIncident);
    res.json({ success: true, test: true, technician, capability, call: result });
  } catch (error) {
    console.error("CALL-E test call error:", error);
    res.status(error?.status || 502).json({ success: false, provider: "calle", code: error?.code || "provider_error", retryable: error?.retryable === true, details: error?.details || null, message: error.message || "CALL-E test call failed." });
  }
});

router.get("/level/:level", async (req, res) => {
  try {
    const level = Number(req.params.level);
    const technicians = await Technician.find({ realmId: req.realmId, level, active: true });
    res.json({ success: true, technicians });
  } catch (error) {
    console.error("Get technicians by level error:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve technicians." });
  }
});

export default router;
