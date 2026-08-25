import express from "express";
import Technician from "../models/Technician.js";
import { callTechnician } from "../services/calleService.js";

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

router.post("/", async (req, res) => {
  try {
    const { technicianId, name, phone, level, role, active = true } = req.body;
    if (!technicianId || !name || !phone || !level) {
      return res.status(400).json({ success: false, message: "Technician ID, name, phone and level are required." });
    }
    const technician = await Technician.create({ technicianId, name, phone, level: Number(level), role, active });
    res.status(201).json({ success: true, technician });
  } catch (error) {
    console.error("Create technician error:", error);
    const duplicate = error?.code === 11000;
    res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "Technician ID already exists." : "Failed to create technician." });
  }
});

router.patch("/:technicianId", async (req, res) => {
  try {
    const technician = await Technician.findOneAndUpdate(
      { technicianId: req.params.technicianId },
      { $set: { ...req.body, level: req.body.level != null ? Number(req.body.level) : undefined } },
      { new: true, runValidators: true }
    );
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

router.post("/:technicianId/test-call", async (req, res) => {
  try {
    const technician = await Technician.findOne({ technicianId: req.params.technicianId, active: true });
    if (!technician) return res.status(404).json({ success: false, message: "Active technician not found." });
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
    res.json({ success: true, test: true, technician, call: result });
  } catch (error) {
    console.error("CALL-E test call error:", error);
    res.status(502).json({ success: false, message: error.message || "CALL-E test call failed." });
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
