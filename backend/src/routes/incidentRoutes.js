import express from "express";
import Incident from "../models/Incident.js";
import { processIncident } from "../services/incidentService.js";

async function generateUniqueIncidentId() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const incidentId = `NET-${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await Incident.exists({ incidentId });
    if (!exists) return incidentId;
  }
  return `NET-${Date.now().toString().slice(-9)}`;
}

export default function incidentRoutes(io) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    try {
      const { device, location, severity, description, technician } = req.body;

      if (!device || !location || !severity || !description || !technician?.phone) {
        return res.status(400).json({ success: false, message: "Missing required incident information." });
      }

      let incident = null;
      for (let attempt = 0; attempt < 5 && !incident; attempt += 1) {
        try {
          incident = await Incident.create({
            incidentId: await generateUniqueIncidentId(),
            device,
            location,
            severity,
            description,
            technician,
            source: "MANUAL"
          });
        } catch (error) {
          if (error?.code !== 11000 || attempt === 4) throw error;
        }
      }

      if (io) io.emit("incident_created", incident);

      processIncident(incident, io).catch(error => {
        console.error("Escalation workflow error:", error);
      });

      return res.status(201).json({
        success: true,
        message: "Incident created and escalation workflow started.",
        incident
      });
    } catch (error) {
      console.error("CREATE INCIDENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to create incident.", error: error.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const incidents = await Incident.find({}).sort({ createdAt: -1 }).lean().exec();
      return res.json({ success: true, incidents });
    } catch (error) {
      console.error("GET INCIDENTS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve incidents.", error: error.message });
    }
  });

  router.get("/:incidentId", async (req, res) => {
    try {
      const incident = await Incident.findOne({ incidentId: req.params.incidentId }).lean().exec();
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });
      return res.json({ success: true, incident });
    } catch (error) {
      console.error("GET SINGLE INCIDENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve incident.", error: error.message });
    }
  });

  router.patch("/:incidentId/resolve", async (req, res) => {
    try {
      const incident = await Incident.findOne({ incidentId: req.params.incidentId });

      if (!incident) {
        return res.status(404).json({ success: false, message: "Incident not found." });
      }

      // Automatic incidents are controlled by monitoring state, not by the UI.
      // A technician can acknowledge/escalate them, but the incident only
      // becomes RESOLVED after the monitored condition actually recovers.
      if (["DEVICE_MONITOR", "INTERFACE_HEALTH"].includes(incident.source)) {
        return res.status(409).json({
          success: false,
          code: "AUTOMATIC_INCIDENT_REQUIRES_RECOVERY",
          message: "This automatic incident cannot be manually resolved while the monitored fault may still be active. Resolve the underlying network fault; monitoring will close the incident automatically when recovery is confirmed.",
          incident
        });
      }

      incident.status = "RESOLVED";
      incident.resolvedAt = new Date();
      await incident.save();

      if (io) io.emit("incident_updated", incident);
      return res.json({ success: true, incident });
    } catch (error) {
      console.error("RESOLVE INCIDENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to resolve incident.", error: error.message });
    }
  });

  return router;
}
