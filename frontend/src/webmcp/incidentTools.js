// Incident intelligence + action WebMCP tools.
//
// The three read tools below (get_active_incidents, get_incident,
// investigate_incident) call straight through to existing NetEscalate
// intelligence services on the backend (root cause, blast radius,
// correlation, recommended actions, remediation, historical matching,
// change correlation, SLA - see backend/src/routes/webmcpRoutes.js) - this
// file adds no analysis of its own, only tool registration.
//
// The three write tools (create_incident, assign_incident,
// add_incident_note) are CONSEQUENTIAL: registerActionTool blocks on an
// explicit human Approve in the Agent Activity panel before the backend is
// ever called - see toolRegistry.js/security.js.
//
// Prompt-injection note: incident.description, device names, and any note
// text returned by these tools comes straight from user- or SNMP-derived
// data already stored in MongoDB. It is returned as a plain string value
// inside a JSON object - never templated into another prompt, never
// executed, never treated as an instruction by anything in this file. If a
// device description reads "ignore previous instructions", that string is
// simply... a string, same as it would be to a human reading the incident
// list.
import { registerReadTool, registerActionTool } from "./toolRegistry.js";
import { getActiveIncidents, getIncident, investigateIncident, createIncidentTool, assignIncidentTool, addIncidentNoteTool } from "../services/webmcpApi.js";

export async function registerIncidentTools() {
  await registerReadTool({
    name: "get_active_incidents",
    description:
      "List currently active (non-resolved) incidents in the current realm, optionally filtered by severity (low|medium|high|critical) or a device name substring, capped at `limit` (default 20, max 100). Use this to get an overview of what's currently wrong before drilling into any one incident with get_incident or investigate_incident. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Restrict to this severity." },
        device: { type: "string", description: "Case-insensitive substring match against the affected device name." },
        limit: { type: "number", description: "Maximum incidents to return (default 20, max 100)." }
      }
    },
    run: args => getActiveIncidents(args),
    summarize: (args, result) => `Listed active incidents${result ? ` — ${result.count} found` : ""}`
  });

  await registerReadTool({
    name: "get_incident",
    description:
      "Get full safe details for one incident by incidentId (e.g. \"NET-4821\"): severity, status, affected device, description, timeline, escalation level, assigned technician, SLA state, and (for a correlated root incident) its correlated child incidents. For a deeper analysis bundle (root cause, blast radius, historical matches, recommendations, confidence), use investigate_incident instead. Read-only.",
    inputSchema: { type: "object", properties: { incidentId: { type: "string", description: "The incident's incidentId, e.g. \"NET-4821\"." } }, required: ["incidentId"] },
    run: ({ incidentId }) => getIncident(incidentId),
    summarize: args => `Retrieved incident ${args?.incidentId}`
  });

  await registerReadTool({
    name: "investigate_incident",
    description:
      "Run a full investigation of one incident by orchestrating every existing NetEscalate intelligence service in one call: root cause analysis, blast radius (affected devices/interfaces/sites), correlated sibling incidents, historical similar-incident matches, possible configuration-change cause, SLA status, and recommended next actions - plus a 0-1 confidence score for the root-cause hypothesis. The response clearly separates OBSERVED facts (incident/device fields) from INFERRED conclusions (rootCause/blastRadius/confidence) from RECOMMENDATIONS (recommendedActions/remediationCatalog, which are suggestions only and take no action). This is the primary tool for answering \"why is X happening\" - prefer it over calling root-cause/blast-radius/etc. separately. Read-only; does not create or change anything.",
    inputSchema: { type: "object", properties: { incidentId: { type: "string", description: "The incident's incidentId, e.g. \"NET-4821\"." } }, required: ["incidentId"] },
    run: ({ incidentId }) => investigateIncident(incidentId),
    summarize: args => `Investigated incident ${args?.incidentId}`
  });

  await registerActionTool({
    name: "create_incident",
    description:
      "Create a new incident in the current realm and start the standard escalation workflow (the same path a NOC engineer's \"Create incident\" button uses). CONSEQUENTIAL - requires explicit human approval, presented in NetEscalate's Agent Activity panel, before it runs. Does not assign a specific technician; call assign_incident afterward (as a separate approved action) to hand it to someone specific, or leave it to the automatic escalation queue.",
    inputSchema: {
      type: "object",
      properties: {
        device: { type: "string", description: "Affected device name, e.g. \"Core-Router-01\"." },
        location: { type: "string", description: "Site/location label." },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        description: { type: "string", description: "Human-readable description of the observed problem and evidence." }
      },
      required: ["device", "location", "severity", "description"]
    },
    run: args => createIncidentTool(args),
    approvalSummary: args => `Create a ${(args?.severity || "").toUpperCase()} incident for ${args?.device || "an unspecified device"}: "${args?.description || ""}"`,
    summarize: (args, result) => `Created incident ${result?.incident?.incidentId || ""} for ${args?.device}`
  });

  await registerActionTool({
    name: "assign_incident",
    description:
      "Assign (or reassign) an active incident to a specific active technician in the current realm, found via find_available_technicians. CONSEQUENTIAL - requires explicit human approval before it runs. Records the assignment on the incident's timeline and updates the dashboard in realtime.",
    inputSchema: {
      type: "object",
      properties: { incidentId: { type: "string", description: "The incident's incidentId, e.g. \"NET-4821\"." }, technicianId: { type: "string", description: "The technician's technicianId, from find_available_technicians." } },
      required: ["incidentId", "technicianId"]
    },
    run: ({ incidentId, technicianId }) => assignIncidentTool(incidentId, technicianId),
    approvalSummary: args => `Assign technician ${args?.technicianId || ""} to incident ${args?.incidentId || ""}`,
    summarize: args => `Assigned ${args?.technicianId} to ${args?.incidentId}`
  });

  await registerActionTool({
    name: "add_incident_note",
    description:
      "Append an investigation note to an incident's timeline, visible to every technician viewing it. CONSEQUENTIAL - requires explicit human approval before it runs (a note is a permanent record attributed to \"AI agent\", so it still gets a confirmation even though it doesn't change incident state).",
    inputSchema: {
      type: "object",
      properties: { incidentId: { type: "string", description: "The incident's incidentId, e.g. \"NET-4821\"." }, message: { type: "string", description: "The note text." } },
      required: ["incidentId", "message"]
    },
    run: ({ incidentId, message }) => addIncidentNoteTool(incidentId, message),
    approvalSummary: args => `Add a note to ${args?.incidentId || "an incident"}: "${args?.message || ""}"`,
    summarize: args => `Added a note to ${args?.incidentId}`
  });
}

export default { registerIncidentTools };
