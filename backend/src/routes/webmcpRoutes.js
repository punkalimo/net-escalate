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
// The 10 read-only GET routes below are thin wrappers around
// webmcpToolHandlers.js - that's where the actual logic (and its only
// implementation) lives now, shared with mcpRoutes.js (the remote MCP +
// OAuth bridge for ChatGPT - see docs/WEBMCP.md). Nothing about their
// behavior changed in this split; webmcpTools.test.js covers that.
//
// Read tools = safe to call with no human confirmation (GET, side-effect
// free). Consequential tools = create/modify state (POST) - the frontend
// tool wrapper (frontend/src/webmcp/security.js) is the enforcement point
// that blocks execution on a pending human approval before these are ever
// called; see that file's comment for why that is a real technical gate,
// not a suggestion. These three stay inline here (not extracted) - they are
// NOT exposed on the remote MCP bridge (see docs/WEBMCP.md for why: the
// `approved` flag below is client-asserted, which the same-browser-tab trust
// model tolerates but a remote OAuth client should not be trusted with).
import express from "express";
import Incident from "../models/Incident.js";
import Technician from "../models/Technician.js";
import { createManualIncident } from "../services/incidentService.js";
import { pushTimelineEvent } from "../services/timelineService.js";
import { emitToRealm } from "../services/realtimeService.js";
import { sanitizeIncidentDetail, toolError, ToolError, logToolInvocation } from "../services/webmcpService.js";
import * as tools from "../services/webmcpToolHandlers.js";

// Wraps a webmcpToolHandlers.js function as a GET route: calls it with
// { realmId, ...req.query/req.params }, logs the invocation, and translates
// a thrown ToolError into the standard error envelope - the exact behavior
// every route below had inline before this file was split.
function readTool(toolName, targetType, handler, buildArgs, buildMetadata) {
  return async (req, res) => {
    try {
      const args = buildArgs(req);
      const result = await handler({ realmId: req.realmId, ...args });
      await logToolInvocation(req, { tool: toolName, classification: "read", targetType, targetId: args.deviceId || args.incidentId || args.technicianId || null, metadata: buildMetadata ? buildMetadata(args) : null });
      return res.json(result);
    } catch (error) {
      if (error instanceof ToolError) return toolError(res, error.status, error.code, error.message);
      console.error(`WEBMCP ${toolName} ERROR:`, error);
      return toolError(res, 500, `${toolName.toUpperCase()}_FAILED`, `Failed to run ${toolName}.`);
    }
  };
}

export default function webmcpRoutes(io) {
  const router = express.Router();

  // ---- Discovery / monitoring (read-only) ---------------------------

  router.get("/devices", readTool("search_devices", "Device", tools.searchDevices, req => ({ query: req.query.query, status: req.query.status, type: req.query.type })));
  router.get("/devices/:deviceId/health", readTool("get_device_health", "Device", tools.getDeviceHealth, req => ({ deviceId: req.params.deviceId })));
  router.get("/devices/:deviceId/interfaces", readTool("get_device_interfaces", "Device", tools.getDeviceInterfaces, req => ({ deviceId: req.params.deviceId })));
  router.get("/devices/:deviceId/interfaces/:ifIndex", readTool("get_interface_health", "Device", tools.getInterfaceHealth, req => ({ deviceId: req.params.deviceId, ifIndex: req.params.ifIndex }), args => ({ ifIndex: args.ifIndex })));

  // ---- Incident intelligence (read-only) ----------------------------

  router.get("/incidents", readTool("get_active_incidents", "Incident", tools.getActiveIncidents, req => ({ severity: req.query.severity, device: req.query.device, limit: req.query.limit })));
  router.get("/incidents/:incidentId", readTool("get_incident", "Incident", tools.getIncident, req => ({ incidentId: req.params.incidentId })));
  router.get("/incidents/:incidentId/investigate", readTool("investigate_incident", "Incident", tools.investigateIncident, req => ({ incidentId: req.params.incidentId })));

  // ---- Topology (read-only) ------------------------------------------

  router.get("/topology", readTool("get_network_topology", "Topology", tools.getNetworkTopology, req => ({ deviceId: req.query.deviceId ? String(req.query.deviceId) : null })));

  // ---- Technicians (read-only) ---------------------------------------

  router.get("/technicians", readTool("find_available_technicians", "Technician", tools.findAvailableTechnicians, req => ({ level: req.query.level, skill: req.query.skill })));
  router.get("/technicians/:technicianId", readTool("get_technician", "Technician", tools.getTechnician, req => ({ technicianId: req.params.technicianId })));

  // ---- Consequential action tools (require prior human approval in the UI) ----
  // Not extracted / not on the remote MCP bridge - see file header.

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
