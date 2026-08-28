import express from "express";
import Incident from "../models/Incident.js";
import Device from "../models/Device.js";
import { processIncident } from "../services/incidentService.js";
import { correlateActiveIncidents, incidentDeviceMatches } from "../services/incidentCorrelationService.js";
import { computeRootCause } from "../services/rootCauseService.js";
import { mergeDownstream, computeBlastRadius } from "../services/blastRadiusService.js";
import { buildTimelineEvent, pushTimelineEvent } from "../services/timelineService.js";
import { computeSlaStatus } from "../services/escalationPolicyService.js";
import { MAX_LEVEL } from "../services/incidentService.js";

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
            source: "MANUAL",
            severityReasons: ["Manually set by a NOC engineer."],
            timeline: [buildTimelineEvent("INCIDENT_CREATED", "Incident manually created.", { actor: technician?.name || "NOC engineer" })]
          });
        } catch (error) {
          if (error?.code !== 11000 || attempt === 4) throw error;
        }
      }

      if (io) io.emit("incident_created", incident);
      processIncident(incident, io).catch(error => console.error("Escalation workflow error:", error));

      return res.status(201).json({ success: true, message: "Incident created and escalation workflow started.", incident });
    } catch (error) {
      console.error("CREATE INCIDENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to create incident.", error: error.message });
    }
  });

  router.get("/", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "500", 10) || 500, 1), 2000);
      const skip = Math.max(Number.parseInt(req.query.skip || "0", 10) || 0, 0);
      const filter = {};
      if (req.query.status && req.query.status !== "ALL") filter.status = req.query.status === "ACTIVE" ? { $ne: "RESOLVED" } : req.query.status;
      if (req.query.severity && req.query.severity !== "ALL") filter.severity = req.query.severity;
      if (req.query.device && req.query.device !== "ALL") filter.device = req.query.device;
      if (req.query.source && req.query.source !== "ALL") filter.source = req.query.source;

      const [incidents, total] = await Promise.all([
        Incident.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
        Incident.countDocuments(filter)
      ]);

      // Correlation is intentionally opt-in. The dashboard polls incidents frequently;
      // topology discovery can involve multiple SNMP walks and must never sit on the
      // critical path for the normal incident list.
      let correlation = null;
      if (req.query.includeCorrelation === "true") {
        try {
          correlation = await correlateActiveIncidents({ forceTopology: req.query.refresh === "true" });
        } catch (correlationError) {
          console.warn("INCIDENT CORRELATION WARNING:", correlationError.message);
        }
      }

      return res.json({
        success: true,
        incidents: correlation?.incidents || incidents,
        pagination: { total, limit, skip, returned: incidents.length, hasMore: skip + incidents.length < total },
        correlation: correlation ? { generatedAt: correlation.generatedAt, correlatedGroups: correlation.correlatedGroups, suppressedChildren: correlation.suppressedChildren, topologyGeneratedAt: correlation.topologyGeneratedAt } : null
      });
    } catch (error) {
      console.error("GET INCIDENTS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve incidents.", error: error.message });
    }
  });

  router.get("/correlation", async (req, res) => {
    try {
      const result = await correlateActiveIncidents({ forceTopology: req.query.refresh === "true" });
      if (io) io.emit("incident_correlation_updated", result);
      return res.json(result);
    } catch (error) {
      console.error("INCIDENT CORRELATION ERROR:", error);
      return res.status(500).json({ success: false, message: "Incident correlation failed.", error: error.message });
    }
  });

  router.post("/correlation/rebuild", async (req, res) => {
    try {
      const result = await correlateActiveIncidents({ forceTopology: true });
      if (io) io.emit("incident_correlation_updated", result);
      return res.json(result);
    } catch (error) {
      console.error("INCIDENT CORRELATION REBUILD ERROR:", error);
      return res.status(500).json({ success: false, message: "Incident correlation rebuild failed.", error: error.message });
    }
  });

  router.post("/:incidentId/merge", async (req, res) => {
    try {
      const { intoIncidentId } = req.body;
      if (!intoIncidentId) return res.status(400).json({ success: false, message: "intoIncidentId is required." });
      if (intoIncidentId === req.params.incidentId) return res.status(400).json({ success: false, message: "Cannot merge an incident into itself." });

      const [source, target] = await Promise.all([
        Incident.findOne({ incidentId: req.params.incidentId }),
        Incident.findOne({ incidentId: intoIncidentId })
      ]);
      if (!source || !target) return res.status(404).json({ success: false, message: "Incident not found." });
      if (source.status === "RESOLVED" || target.status === "RESOLVED") {
        return res.status(409).json({ success: false, code: "CANNOT_MERGE_RESOLVED_INCIDENT", message: "Resolved incidents cannot be merged." });
      }
      if (target.correlationRole === "CHILD" && target.parentIncidentId) {
        return res.status(409).json({ success: false, code: "TARGET_NOT_A_ROOT", message: `${target.incidentId} is already part of group ${target.correlationGroupId} under root ${target.parentIncidentId}. Merge into ${target.parentIncidentId} instead.` });
      }
      if (source.correlationGroupId && source.correlationGroupId === target.correlationGroupId) {
        return res.status(409).json({ success: false, code: "ALREADY_IN_GROUP", message: "These incidents are already in the same correlation group." });
      }

      const groupId = target.correlationGroupId || `COR-${target.incidentId}`;

      // If the source is itself a root with existing children, cascade them
      // into the new group too rather than leaving them orphaned.
      const cascaded = source.correlationRole === "ROOT" && source.correlationGroupId
        ? await Incident.find({ correlationGroupId: source.correlationGroupId, correlationRole: "CHILD" })
        : [];

      target.correlationGroupId = groupId;
      target.correlationRole = "ROOT";
      target.parentIncidentId = null;
      target.correlationManual = true;
      pushTimelineEvent(target, "MERGED", `${source.incidentId} was manually merged into this incident as a correlated symptom.`, { actor: "NOC engineer" });
      await target.save();

      source.correlationGroupId = groupId;
      source.correlationRole = "CHILD";
      source.parentIncidentId = target.incidentId;
      source.correlationConfidence = 100;
      source.correlationEvidence = ["Manually merged by a NOC engineer."];
      source.correlationManual = true;
      pushTimelineEvent(source, "MERGED", `Manually merged into ${target.incidentId} as a correlated symptom.`, { actor: "NOC engineer" });
      await source.save();

      for (const child of cascaded) {
        child.correlationGroupId = groupId;
        child.parentIncidentId = target.incidentId;
        child.correlationManual = true;
        pushTimelineEvent(child, "MERGED", `Carried along into ${target.incidentId}'s group when ${source.incidentId} (its previous root) was merged.`, { actor: "NOC engineer" });
        await child.save();
        if (io) io.emit("incident_updated", child);
      }

      if (io) { io.emit("incident_updated", target); io.emit("incident_updated", source); }

      const correlation = await correlateActiveIncidents();
      if (io) io.emit("incident_correlation_updated", correlation);
      return res.json({ success: true, target: target.toObject(), source: source.toObject(), correlation });
    } catch (error) {
      console.error("MERGE INCIDENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to merge incidents.", error: error.message });
    }
  });

  router.post("/:incidentId/unmerge", async (req, res) => {
    try {
      const incident = await Incident.findOne({ incidentId: req.params.incidentId });
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });
      if (incident.status === "RESOLVED") {
        return res.status(409).json({ success: false, code: "CANNOT_UNMERGE_RESOLVED_INCIDENT", message: "Resolved incidents cannot be unmerged." });
      }
      if (incident.correlationRole !== "CHILD") {
        return res.status(400).json({ success: false, message: "Only a correlated child incident can be unmerged. To dissolve a whole group, unmerge each child individually." });
      }

      const previousParent = incident.parentIncidentId;
      incident.correlationGroupId = null;
      incident.correlationRole = "STANDALONE";
      incident.parentIncidentId = null;
      incident.correlationConfidence = null;
      incident.correlationEvidence = [];
      incident.correlationManual = true;
      pushTimelineEvent(incident, "UNMERGED", `Manually unmerged from root incident ${previousParent}.`, { actor: "NOC engineer" });
      await incident.save();
      if (io) io.emit("incident_updated", incident);

      const correlation = await correlateActiveIncidents();
      if (io) io.emit("incident_correlation_updated", correlation);
      return res.json({ success: true, incident: incident.toObject(), correlation });
    } catch (error) {
      console.error("UNMERGE INCIDENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to unmerge incident.", error: error.message });
    }
  });

  router.post("/:incidentId/comment", async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      const actor = String(req.body?.actor || "NOC engineer").trim() || "NOC engineer";
      if (!message) return res.status(400).json({ success: false, message: "Comment message is required." });

      const incident = await Incident.findOne({ incidentId: req.params.incidentId });
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });

      pushTimelineEvent(incident, "ENGINEER_COMMENT", message, { actor });
      await incident.save();
      if (io) io.emit("incident_updated", incident);
      return res.json({ success: true, incident: incident.toObject() });
    } catch (error) {
      console.error("INCIDENT COMMENT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to add comment.", error: error.message });
    }
  });

  router.get("/:incidentId/sla", async (req, res) => {
    try {
      const incident = await Incident.findOne({ incidentId: req.params.incidentId }).lean();
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });
      return res.json({ success: true, sla: computeSlaStatus(incident, { maxLevel: MAX_LEVEL }) });
    } catch (error) {
      console.error("INCIDENT SLA ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to compute SLA status.", error: error.message });
    }
  });

  router.get("/:incidentId/root-cause", async (req, res) => {
    try {
      const incident = await Incident.findOne({ incidentId: req.params.incidentId }).lean();
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });

      const devices = await Device.find({}).lean();
      const device = devices.find(d => incidentDeviceMatches(incident, d)) || null;

      let children = [];
      if (incident.correlationRole === "ROOT" && incident.correlationGroupId) {
        const childDocs = await Incident.find({ correlationGroupId: incident.correlationGroupId, correlationRole: "CHILD" }).select("device interfaceName createdAt").lean();
        children = childDocs.map(child => ({ hostname: child.device, interfaceName: child.interfaceName, createdAt: child.createdAt }));
      }

      return res.json({ success: true, rootCause: computeRootCause(incident, { device, children }) });
    } catch (error) {
      console.error("INCIDENT ROOT CAUSE ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to compute root cause.", error: error.message });
    }
  });

  router.get("/:incidentId/blast-radius", async (req, res) => {
    try {
      const incident = await Incident.findOne({ incidentId: req.params.incidentId }).lean();
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });

      const devices = await Device.find({}).lean();
      const deviceById = new Map(devices.map(d => [d.deviceId, d]));
      const rootDevice = devices.find(d => incidentDeviceMatches(incident, d)) || null;

      let childRefs = [];
      if (incident.correlationRole === "ROOT" && incident.correlationGroupId) {
        const childDocs = await Incident.find({ correlationGroupId: incident.correlationGroupId, correlationRole: "CHILD" }).select("device interfaceName createdAt").lean();
        childRefs = childDocs.map(child => {
          const childDevice = devices.find(d => incidentDeviceMatches(child, d)) || null;
          return { deviceId: childDevice?.deviceId || null, hostname: childDevice?.hostname || child.device, interfaceName: child.interfaceName, createdAt: child.createdAt };
        });
      }

      const downstream = mergeDownstream(childRefs, incident.impactedDevices);
      return res.json({ success: true, blastRadius: computeBlastRadius(incident, { rootDevice, downstream, deviceById }) });
    } catch (error) {
      console.error("INCIDENT BLAST RADIUS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to compute blast radius.", error: error.message });
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
      if (!incident) return res.status(404).json({ success: false, message: "Incident not found." });

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
      pushTimelineEvent(incident, "INCIDENT_RESOLVED", "Incident manually resolved by a NOC engineer.", { actor: "NOC engineer" });
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
