// Technician/escalation WebMCP tools - read-only. Scoped to the current
// realm server-side; a technician from another realm is never returned
// (see backend/src/routes/webmcpRoutes.js). Never exposes a password hash
// or login credentials - only hasLogin (boolean) is surfaced.
import { registerReadTool } from "./toolRegistry.js";
import { findAvailableTechnicians, getTechnician } from "../services/webmcpApi.js";

export async function registerTechnicianTools() {
  await registerReadTool({
    name: "find_available_technicians",
    description:
      "List active technicians/engineers in the current realm available for escalation, optionally filtered by escalation level (1=first-line, 3=senior/on-call) or a skill keyword matched against their role title (e.g. \"senior\", \"network\"). Use this before assign_incident to pick a specific technician to hand an incident to. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Case-insensitive keyword matched against the technician's role title, e.g. \"senior\" or \"network\"." },
        level: { type: "number", description: "Exact escalation level (1, 2 or 3)." }
      }
    },
    run: args => findAvailableTechnicians(args),
    summarize: (args, result) => `Looked up available technicians${result ? ` — ${result.count} found` : ""}`
  });

  await registerReadTool({
    name: "get_technician",
    description: "Retrieve safe profile information (name, phone, role, escalation level, whether they have dashboard login access) for one technician by technicianId. Never returns a password or login token. Read-only.",
    inputSchema: { type: "object", properties: { technicianId: { type: "string", description: "The technician's technicianId, from find_available_technicians." } }, required: ["technicianId"] },
    run: ({ technicianId }) => getTechnician(technicianId),
    summarize: args => `Looked up technician ${args?.technicianId}`
  });
}

export default { registerTechnicianTools };
