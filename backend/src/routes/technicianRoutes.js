import express from "express";
import Technician from "../models/Technician.js";
import { callTechnician, getCallCapability } from "../services/calleService.js";
import { hashPassword } from "../services/authService.js";
import { requireLevel } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const technicians = await Technician.find().sort({ level: 1, name: 1 });
    res.json({ success: true, technicians });
  } catch (error) {
    console.error("Get technicians error:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve technicians." });
  }
});

// Only a Level 3 (senior/on-call) technician can add new escalation
// contacts - see the "Add technician" gating in the Escalation Team panel.
router.post("/", requireLevel(3), async (req, res) => {
  try {
    const { technicianId, name, phone, level, role, active = true } = req.body;
    if (!technicianId || !name || !phone || !level) return res.status(400).json({ success: false, message: "Technician ID, name, phone and level are required." });
    const technician = await Technician.create({ technicianId, name, phone, level: Number(level), role, active });
    res.status(201).json({ success: true, technician });
  } catch (error) {
    console.error("Create technician error:", error);
    const duplicate = error?.code === 11000;
    res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "Technician ID already exists." : "Failed to create technician." });
  }
});

// Grants or resets a technician's dashboard login. Level 3 only, same as
// creating a technician - this is the in-app replacement for the
// create-admin.mjs bootstrap script for day-to-day use (new hire, or
// someone forgot their password).
router.post("/:technicianId/credentials", requireLevel(3), async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!username || password.length < 8) return res.status(400).json({ success: false, message: "Username and an at-least-8-character password are required." });

    const technician = await Technician.findOne({ technicianId: req.params.technicianId });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });

    technician.username = username;
    technician.passwordHash = await hashPassword(password);
    await technician.save();
    res.json({ success: true, technician });
  } catch (error) {
    console.error("Set technician credentials error:", error);
    const duplicate = error?.code === 11000;
    res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "That username is already taken." : "Failed to set login credentials." });
  }
});

router.patch("/:technicianId", async (req, res) => {
  try {
    const technician = await Technician.findOneAndUpdate({ technicianId: req.params.technicianId }, { $set: { ...req.body, level: req.body.level != null ? Number(req.body.level) : undefined } }, { new: true, runValidators: true });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    res.json({ success: true, technician });
  } catch (error) {
    console.error("Update technician error:", error);
    res.status(500).json({ success: false, message: "Failed to update technician." });
  }
});

router.delete("/:technicianId", async (req, res) => {
  try {
    const technician = await Technician.findOneAndDelete({ technicianId: req.params.technicianId });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    res.json({ success: true, technicianId: req.params.technicianId });
  } catch (error) {
    console.error("Delete technician error:", error);
    res.status(500).json({ success: false, message: "Failed to delete technician." });
  }
});

router.get("/:technicianId/capability", async (req, res) => {
  try {
    const technician = await Technician.findOne({ technicianId: req.params.technicianId });
    if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
    res.json({ success: true, capability: getCallCapability(technician.phone) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to determine CALL-E capability." });
  }
});

router.post("/:technicianId/test-call", async (req, res) => {
  try {
    const technician = await Technician.findOne({ technicianId: req.params.technicianId, active: true });
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
    const technicians = await Technician.find({ level, active: true });
    res.json({ success: true, technicians });
  } catch (error) {
    console.error("Get technicians by level error:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve technicians." });
  }
});

export default router;
