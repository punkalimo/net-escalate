// Agent-facing tool endpoints backing frontend/src/webmcp/*.js.
//
// Mounted at /api/webmcp, behind the exact same middleware every other
// tenant route sits behind (requireAuth -> attachRealmScope, wired in
// server.js) - a WebMCP tool call is just another authenticated HTTP
// request from the same browser session as the human dashboard. There is
// no separate "agent identity" and no way for a tool to supply its own
// realmId: req.realmId is computed once, upstream, from the session
// cookie (see authMiddleware.js's attachRealmScope), exactly like every
// route in incidentRoutes.js/deviceRoutes.js/technicianRoutes.js.
//
// This file contains NO new intelligence logic - every computed fact
// (root cause, blast radius, recommended actions, SLA, similar incidents,
// change correlation, topology) is produced by the existing service of the
// same name that the human dashboard already calls. See docs/WEBMCP.md.
//
// Read tools = safe to call with no human confirmation (GET, side-effect
// free). Consequential tools = create/modify state (POST) - the frontend
// tool wrapper (frontend/src/webmcp/security.js) is the enforcement point
// that blocks execution on a pending human approval before these are ever
// called; see that file's comment for why that is a real technical gate,
// not a suggestion.
import express from "express";
import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import Technician from "../models/Technician.js";
import InterfaceSample from "../models/InterfaceSample.js";
import { createManualIncident } from "../services/incidentService.js";
import { correlateActiveIncidents, incidentDeviceMatches } from "../services/incidentCorrelationService.js";
import { computeRootCause } from "../services/rootCauseService.js";
import { mergeDownstream, computeBlastRadius } from "../services/blastRadiusService.js";
import { computeRecommendedActions } from "../services/recommendedActionsService.js";
import { computeRemediationCatalog } from "../services/remediationService.js";
import { findSimilarIncidents } from "../services/historicalMatchService.js";
import { findPossibleChangeCause } from "../services/changeCorrelationService.js";
import { computeSlaStatus } from "../services/escalationPolicyService.js";
import { MAX_LEVEL } from "../services/incidentService.js";
import { discoverTopology } from "../services/topologyService.js";
import { pushTimelineEvent } from "../services/timelineService.js";
import { emitToRealm } from "../services/realtimeService.js";
import { sanitizeDevice, sanitizeDeviceHealth, sanitizeInterface, sanitizeTechnician, sanitizeIncidentSummary, sanitizeIncidentDetail, toolError, logToolInvocation } from "../services/webmcpService.js";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadIncidentAndDevice(incidentId, realmId) {
  const incident = await Incident.findOne({ incidentId, realmId }).lean();
  if (!incident) return { incident: null, device: null, devices: [] };
  const devices = await Device.find({ realmId }).lean();
  const device = devices.find(d => incidentDeviceMatches(incident, d)) || null;
  return { incident, device, devices };
}

async function loadCorrelationChildren(incident, realmId) {
  if (incident.correlationRole !== "ROOT" || !incident.correlationGroupId) return [];
  return Incident.find({ realmId, correlationGroupId: incident.correlationGroupId, correlationRole: "CHILD" }).select("device deviceId interfaceName createdAt").lean();
}

export default function webmcpRoutes(io) {
  const router = express.Router();

  // ---- Discovery / monitoring (read-only) ---------------------------

  router.get("/devices", async (req, res) => {
    try {
      const { query, status, type } = req.query;
      const filter = { realmId: req.realmId };
      if (status) filter.status = String(status).toUpperCase();
      if (type) filter.deviceType = String(type).toLowerCase();
      if (query) {
        const pattern = new RegExp(escapeRegex(query), "i");
        filter.$or = [{ hostname: pattern }, { ipAddress: pattern }, { vendor: pattern }, { model: pattern }, { deviceId: pattern }];
      }
      const devices = await Device.find(filter).sort({ hostname: 1 }).limit(25).lean();
      await logToolInvocation(req, { tool: "search_devices", classification: "read", targetType: "Device" });
      return res.json({ success: true, count: devices.length, devices: devices.map(sanitizeDevice) });
    } catch (error) {
      console.error("WEBMCP search_devices ERROR:", error);
      return toolError(res, 500, "SEARCH_DEVICES_FAILED", "Failed to search devices.");
    }
  });

  router.get("/devices/:deviceId/health", async (req, res) => {
    try {
      const device = await Device.findOne({ deviceId: req.params.deviceId, realmId: req.realmId }).lean();
      if (!device) return toolError(res, 404, "DEVICE_NOT_FOUND", `Device ${req.params.deviceId} was not found in the current realm.`);
      await logToolInvocation(req, { tool: "get_device_health", classification: "read", targetType: "Device", targetId: device.deviceId });
      return res.json({ success: true, health: sanitizeDeviceHealth(device) });
    } catch (error) {
      console.error("WEBMCP get_device_health ERROR:", error);
      return toolError(res, 500, "DEVICE_HEALTH_FAILED", "Failed to retrieve device health.");
    }
  });

  router.get("/devices/:deviceId/interfaces", async (req, res) => {
    try {
      const device = await Device.findOne({ deviceId: req.params.deviceId, realmId: req.realmId }).lean();
      if (!device) return toolError(res, 404, "DEVICE_NOT_FOUND", `Device ${req.params.deviceId} was not found in the current realm.`);
      await logToolInvocation(req, { tool: "get_device_interfaces", classification: "read", targetType: "Device", targetId: device.deviceId });
      return res.json({ success: true, deviceId: device.deviceId, hostname: device.hostname, count: (device.interfaces || []).length, interfaces: (device.interfaces || []).map(sanitizeInterface) });
    } catch (error) {
      console.error("WEBMCP get_device_interfaces ERROR:", error);
      return toolError(res, 500, "DEVICE_INTERFACES_FAILED", "Failed to retrieve device interfaces.");
    }
  });

  router.get("/devices/:deviceId/interfaces/:ifIndex", async (req, res) => {
    try {
      const ifIndex = Number(req.params.ifIndex);
      if (!Number.isInteger(ifIndex) || ifIndex < 1) return toolError(res, 400, "INVALID_INTERFACE_INDEX", "ifIndex must be a positive integer.");

      const device = await Device.findOne({ deviceId: req.params.deviceId, realmId: req.realmId }).lean();
      if (!device) return toolError(res, 404, "DEVICE_NOT_FOUND", `Device ${req.params.deviceId} was not found in the current realm.`);
      const iface = (device.interfaces || []).find(item => Number(item.ifIndex) === ifIndex);
      if (!iface) return toolError(res, 404, "INTERFACE_NOT_FOUND", `Interface ${ifIndex} was not found on ${device.hostname}.`);

      const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const recentSamples = await InterfaceSample.find({ realmId: req.realmId, deviceId: device.deviceId, ifIndex, sampledAt: { $gte: since } })
        .sort({ sampledAt: -1 }).limit(10).select("status utilizationPercent inBps outBps inErrors outErrors errorRatePerMin discardRatePerMin health sampledAt").lean();

      await logToolInvocation(req, { tool: "get_interface_health", classification: "read", targetType: "Device", targetId: device.deviceId, metadata: { ifIndex } });
      return res.json({
        success: true,
        deviceId: device.deviceId,
        hostname: device.hostname,
        interface: sanitizeInterface(iface),
        recentSamples: recentSamples.reverse()
      });
    } catch (error) {
      console.error("WEBMCP get_interface_health ERROR:", error);
      return toolError(res, 500, "INTERFACE_HEALTH_FAILED", "Failed to retrieve interface health.");
    }
  });

  // ---- Incident intelligence (read-only) ----------------------------

  router.get("/incidents", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "20", 10) || 20, 1), 100);
      const filter = { realmId: req.realmId, status: { $ne: "RESOLVED" } };
      if (req.query.severity) filter.severity = String(req.query.severity).toLowerCase();
      if (req.query.device) filter.device = new RegExp(escapeRegex(req.query.device), "i");

      const incidents = await Incident.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
      await logToolInvocation(req, { tool: "get_active_incidents", classification: "read", targetType: "Incident" });
      return res.json({ success: true, count: incidents.length, incidents: incidents.map(sanitizeIncidentSummary) });
    } catch (error) {
      console.error("WEBMCP get_active_incidents ERROR:", error);
      return toolError(res, 500, "ACTIVE_INCIDENTS_FAILED", "Failed to retrieve active incidents.");
    }
  });

  router.get("/incidents/:incidentId", async (req, res) => {
    try {
      const { incident, device } = await loadIncidentAndDevice(req.params.incidentId, req.realmId);
      if (!incident) return toolError(res, 404, "INCIDENT_NOT_FOUND", `Incident ${req.params.incidentId} was not found in the current realm.`);

      const children = await loadCorrelationChildren(incident, req.realmId);
      const [sla, rootCause] = [
        computeSlaStatus(incident, { maxLevel: MAX_LEVEL }),
        computeRootCause(incident, { device, children: children.map(c => ({ hostname: c.device, interfaceName: c.interfaceName, createdAt: c.createdAt })) })
      ];

      await logToolInvocation(req, { tool: "get_incident", classification: "read", targetType: "Incident", targetId: incident.incidentId });
      return res.json({
        success: true,
        incident: sanitizeIncidentDetail(incident),
        device: device ? sanitizeDevice(device) : null,
        sla,
        rootCause,
        correlatedChildren: children.map(c => ({ incidentId: c.incidentId, device: c.device, interfaceName: c.interfaceName }))
      });
    } catch (error) {
      console.error("WEBMCP get_incident ERROR:", error);
      return toolError(res, 500, "GET_INCIDENT_FAILED", "Failed to retrieve incident.");
    }
  });

  // The high-value orchestration tool: bundles every existing intelligence
  // service's output for one incident into a single agent-optimized
  // response. Nothing here is computed twice or invented - each field is a
  // direct pass-through of the same service the human dashboard's
  // IncidentDetails/RootCauseCenter panels call individually.
  router.get("/incidents/:incidentId/investigate", async (req, res) => {
    try {
      const { incident, device, devices } = await loadIncidentAndDevice(req.params.incidentId, req.realmId);
      if (!incident) return toolError(res, 404, "INCIDENT_NOT_FOUND", `Incident ${req.params.incidentId} was not found in the current realm.`);

      const deviceById = new Map(devices.map(d => [d.deviceId, d]));
      const childDocs = await loadCorrelationChildren(incident, req.realmId);
      const childRefs = childDocs.map(child => {
        const childDevice = devices.find(d => incidentDeviceMatches(child, d)) || null;
        return { deviceId: childDevice?.deviceId || null, hostname: childDevice?.hostname || child.device, interfaceName: child.interfaceName, createdAt: child.createdAt };
      });
      const downstream = mergeDownstream(childRefs, incident.impactedDevices);

      const [rootCause, blastRadius, similarIncidents, possibleChangeCause, sla] = await Promise.all([
        Promise.resolve(computeRootCause(incident, { device, children: childRefs })),
        Promise.resolve(computeBlastRadius(incident, { rootDevice: device, downstream, deviceById })),
        findSimilarIncidents(incident),
        findPossibleChangeCause(incident),
        Promise.resolve(computeSlaStatus(incident, { maxLevel: MAX_LEVEL }))
      ]);
      const recommendedActions = computeRecommendedActions(incident, { device, blastRadius });
      const remediationCatalog = computeRemediationCatalog(incident, { device });

      // correlateActiveIncidents recomputes the whole realm's correlation
      // graph (it has its own 30s cache - see incidentCorrelationService.js)
      // to report this incident's group in the same shape the dashboard uses.
      let correlationGroup = null;
      try {
        const correlation = await correlateActiveIncidents({ realmId: req.realmId });
        correlationGroup = (correlation.groups || []).find(g => g.rootIncidentId === incident.incidentId || g.correlationGroupId === incident.correlationGroupId) || null;
      } catch (correlationError) {
        console.warn("WEBMCP investigate_incident correlation warning:", correlationError.message);
      }

      await logToolInvocation(req, { tool: "investigate_incident", classification: "read", targetType: "Incident", targetId: incident.incidentId });

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        // OBSERVED FACTS - directly read off the incident/device records, not inferred.
        incident: sanitizeIncidentDetail(incident),
        device: device ? sanitizeDevice(device) : null,
        correlation: correlationGroup ? { correlationGroupId: correlationGroup.correlationGroupId, children: correlationGroup.children, confidence: correlationGroup.children?.[0]?.confidence ?? null } : { correlationGroupId: incident.correlationGroupId || null, children: childRefs.map(c => ({ hostname: c.hostname, interfaceName: c.interfaceName })) },
        sla,
        // INFERRED CONCLUSIONS - computed by existing analysis services from the observed facts above.
        rootCause,
        blastRadius,
        historicalMatches: similarIncidents,
        possibleChangeCause,
        // RECOMMENDATIONS - suggested next steps; not automatically taken.
        recommendedActions,
        remediationCatalog,
        // rootCauseService's own confidence score IS the investigation's
        // overall confidence - it is already computed from the strength of
        // the evidence (device match, correlated children, fault type), so
        // this deliberately isn't re-derived or blended with anything else.
        confidence: typeof rootCause?.confidence === "number" ? rootCause.confidence / 100 : null
      });
    } catch (error) {
      console.error("WEBMCP investigate_incident ERROR:", error);
      return toolError(res, 500, "INVESTIGATE_INCIDENT_FAILED", "Failed to investigate incident.");
    }
  });

  // ---- Topology (read-only) ------------------------------------------

  router.get("/topology", async (req, res) => {
    try {
      const topology = await discoverTopology(req.realmId);
      const deviceId = req.query.deviceId ? String(req.query.deviceId) : null;
      await logToolInvocation(req, { tool: "get_network_topology", classification: "read", targetType: "Topology", targetId: deviceId });

      if (!deviceId) return res.json(topology);

      // Optional deviceId narrows the response to that node plus its direct
      // neighbors, so an agent investigating one device doesn't have to
      // wade through the whole topology graph to find upstream/downstream.
      const neighborIds = new Set();
      const edges = (topology.edges || []).filter(edge => {
        const touches = edge.source === deviceId || edge.target === deviceId;
        if (touches) { neighborIds.add(edge.source); neighborIds.add(edge.target); }
        return touches;
      });
      const nodes = (topology.nodes || []).filter(node => node.id === deviceId || neighborIds.has(node.id));
      return res.json({ ...topology, nodes, edges, focusedOn: deviceId });
    } catch (error) {
      console.error("WEBMCP get_network_topology ERROR:", error);
      return toolError(res, 500, "TOPOLOGY_FAILED", "Failed to retrieve network topology.");
    }
  });

  // ---- Technicians (read-only) ---------------------------------------

  router.get("/technicians", async (req, res) => {
    try {
      const filter = { realmId: req.realmId, active: true };
      if (req.query.level) filter.level = Number(req.query.level);
      let technicians = await Technician.find(filter).sort({ level: 1, name: 1 }).lean();
      if (req.query.skill) {
        const pattern = new RegExp(escapeRegex(req.query.skill), "i");
        technicians = technicians.filter(t => pattern.test(t.role || ""));
      }
      await logToolInvocation(req, { tool: "find_available_technicians", classification: "read", targetType: "Technician" });
      return res.json({ success: true, count: technicians.length, technicians: technicians.map(sanitizeTechnician) });
    } catch (error) {
      console.error("WEBMCP find_available_technicians ERROR:", error);
      return toolError(res, 500, "FIND_TECHNICIANS_FAILED", "Failed to find available technicians.");
    }
  });

  router.get("/technicians/:technicianId", async (req, res) => {
    try {
      const technician = await Technician.findOne({ technicianId: req.params.technicianId, realmId: req.realmId }).lean();
      if (!technician) return toolError(res, 404, "TECHNICIAN_NOT_FOUND", `Technician ${req.params.technicianId} was not found in the current realm.`);
      await logToolInvocation(req, { tool: "get_technician", classification: "read", targetType: "Technician", targetId: technician.technicianId });
      return res.json({ success: true, technician: sanitizeTechnician(technician) });
    } catch (error) {
      console.error("WEBMCP get_technician ERROR:", error);
      return toolError(res, 500, "GET_TECHNICIAN_FAILED", "Failed to retrieve technician.");
    }
  });

  // ---- Consequential action tools (require prior human approval in the UI) ----

  router.post("/incidents", async (req, res) => {
    try {
      const device = String(req.body?.device || "").trim();
      const location = String(req.body?.location || "").trim();
      const severity = String(req.body?.severity || "").toLowerCase();
      const description = String(req.body?.description || "").trim();
      if (!device || !location || !description || !["low", "medium", "high", "critical"].includes(severity)) {
        return toolError(res, 400, "INVALID_INPUT", "device, location, description and a valid severity (low|medium|high|critical) are required.");
      }
      if (!req.body?.approved) return toolError(res, 400, "APPROVAL_REQUIRED", "This tool requires human approval before it can run. Set approved:true only after the user has explicitly confirmed.");

      const incident = await createManualIncident({ realmId: req.realmId, device, location, severity, description, source: "AGENT", actorLabel: "AI agent" }, io);
      await logToolInvocation(req, { tool: "create_incident", classification: "write", targetType: "Incident", targetId: incident.incidentId, approval: "approved", result: "success" });
      return res.status(201).json({ success: true, message: "Incident created and escalation workflow started.", incident: sanitizeIncidentDetail(incident.toObject ? incident.toObject() : incident) });
    } catch (error) {
      console.error("WEBMCP create_incident ERROR:", error);
      await logToolInvocation(req, { tool: "create_incident", classification: "write", approval: "approved", result: "error" });
      return toolError(res, 500, "CREATE_INCIDENT_FAILED", "Failed to create incident.");
    }
  });

  router.post("/incidents/:incidentId/assign", async (req, res) => {
    try {
      const technicianId = String(req.body?.technicianId || "").trim();
      if (!technicianId) return toolError(res, 400, "INVALID_INPUT", "technicianId is required.");
      if (!req.body?.approved) return toolError(res, 400, "APPROVAL_REQUIRED", "This tool requires human approval before it can run. Set approved:true only after the user has explicitly confirmed.");

      const incident = await Incident.findOne({ incidentId: req.params.incidentId, realmId: req.realmId });
      if (!incident) return toolError(res, 404, "INCIDENT_NOT_FOUND", `Incident ${req.params.incidentId} was not found in the current realm.`);
      if (incident.status === "RESOLVED") return toolError(res, 409, "INCIDENT_RESOLVED", "Resolved incidents cannot be reassigned.");

      const technician = await Technician.findOne({ technicianId, realmId: req.realmId, active: true }).lean();
      if (!technician) return toolError(res, 404, "TECHNICIAN_NOT_FOUND", "Active technician not found in this realm.");

      incident.technician = { id: technician.technicianId, name: technician.name, phone: technician.phone, role: technician.role };
      incident.escalationLevel = Math.max(Number(incident.escalationLevel) || 1, Number(technician.level) || 1);
      pushTimelineEvent(incident, "ENGINEER_ASSIGNED", `${technician.name} (Level ${technician.level}, ${technician.role}) was assigned to this incident by an AI agent (human-approved).`, { actor: "AI agent" });
      await incident.save();
      if (io) emitToRealm(req.realmId, "incident_updated", incident);

      await logToolInvocation(req, { tool: "assign_incident", classification: "write", targetType: "Incident", targetId: incident.incidentId, approval: "approved", result: "success", metadata: { technicianId } });
      return res.json({ success: true, incident: sanitizeIncidentDetail(incident.toObject()) });
    } catch (error) {
      console.error("WEBMCP assign_incident ERROR:", error);
      await logToolInvocation(req, { tool: "assign_incident", classification: "write", approval: "approved", result: "error" });
      return toolError(res, 500, "ASSIGN_INCIDENT_FAILED", "Failed to assign incident.");
    }
  });

  router.post("/incidents/:incidentId/notes", async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message) return toolError(res, 400, "INVALID_INPUT", "message is required.");
      if (!req.body?.approved) return toolError(res, 400, "APPROVAL_REQUIRED", "This tool requires human approval before it can run. Set approved:true only after the user has explicitly confirmed.");

      const incident = await Incident.findOne({ incidentId: req.params.incidentId, realmId: req.realmId });
      if (!incident) return toolError(res, 404, "INCIDENT_NOT_FOUND", `Incident ${req.params.incidentId} was not found in the current realm.`);

      // The note text is untrusted, agent-authored content going INTO the
      // record (the reverse direction from the prompt-injection boundary
      // documented in docs/WEBMCP.md) - stored as plain text in the same
      // timeline array a human comment uses; never templated/evaluated.
      pushTimelineEvent(incident, "ENGINEER_COMMENT", message, { actor: "AI agent" });
      await incident.save();
      if (io) emitToRealm(req.realmId, "incident_updated", incident);

      await logToolInvocation(req, { tool: "add_incident_note", classification: "write", targetType: "Incident", targetId: incident.incidentId, approval: "approved", result: "success" });
      return res.json({ success: true, incident: sanitizeIncidentDetail(incident.toObject()) });
    } catch (error) {
      console.error("WEBMCP add_incident_note ERROR:", error);
      await logToolInvocation(req, { tool: "add_incident_note", classification: "write", approval: "approved", result: "error" });
      return toolError(res, 500, "ADD_NOTE_FAILED", "Failed to add incident note.");
    }
  });

  return router;
}
