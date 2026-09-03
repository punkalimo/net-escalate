// The remote MCP bridge for ChatGPT (and any other MCP client that only
// speaks HTTPS+OAuth, never local stdio - see docs/WEBMCP.md's "Remote MCP
// + OAuth" section for why this exists alongside the browser-based WebMCP
// layer and the @mcp-b/webmcp-local-relay bridge).
//
// Mounted at /mcp (top-level, NOT under /api - see server.js), gated by
// requireMcpAuth (Bearer mcp_access token, not the session cookie). Only
// the 10 READ-ONLY tools are registered here - create_incident/
// assign_incident/add_incident_note are deliberately absent: those gate on
// a client-supplied `approved: true` boolean with no server-side proof a
// human ever saw the request, which the same-browser-tab trust model of the
// existing WebMCP layer tolerates but a remote, publicly-reachable OAuth
// client should not be trusted with. See webmcpRoutes.js's header for the
// full reasoning.
//
// Every tool below calls the exact same function webmcpRoutes.js calls
// (webmcpToolHandlers.js) - there is no second implementation of any tool's
// logic here, only a different transport/auth wrapper around it.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { requireMcpAuth } from "../middleware/mcpAuthMiddleware.js";
import { logToolInvocation } from "../services/webmcpService.js";
import * as tools from "../services/webmcpToolHandlers.js";

function toContent(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function toErrorContent(error) {
  const code = error?.code || "TOOL_FAILED";
  const message = error?.message || "The tool call failed unexpectedly. No changes were made.";
  return { content: [{ type: "text", text: JSON.stringify({ success: false, error: { code, message } }) }], isError: true };
}

// One McpServer per request (stateless mode - sessionIdGenerator: undefined
// below) so req/req.realmId can be captured in each tool's closure without
// any server-side session state to manage between requests.
function buildServer(req) {
  const server = new McpServer({ name: "netescalate", version: "1.0.0" }, { capabilities: { tools: {} } });

  function readTool(name, targetType, handler, inputSchema, description) {
    server.registerTool(name, { description, inputSchema }, async args => {
      try {
        const result = await handler({ realmId: req.realmId, ...args });
        await logToolInvocation(req, {
          tool: name,
          classification: "read",
          targetType,
          targetId: args.deviceId || args.incidentId || args.technicianId || null,
          metadata: { channel: "remote_mcp", clientId: req.mcpClientId }
        });
        return toContent(result);
      } catch (error) {
        return toErrorContent(error);
      }
    });
  }

  readTool(
    "search_devices", "Device", tools.searchDevices,
    {
      query: z.string().optional().describe("Free-text match against hostname, IP address, vendor or model. Omit to list devices matching only the filters below."),
      status: z.enum(["UP", "DOWN", "DEGRADED", "UNKNOWN"]).optional().describe("Restrict to devices currently in this monitoring status."),
      type: z.enum(["router", "switch", "firewall", "server", "access-point", "printer", "other"]).optional().describe("Restrict to this device type.")
    },
    "Find network devices (routers, switches, firewalls, servers, access points) in the current user's realm by hostname, IP address, vendor or model, optionally filtered by monitoring status or device type. Read-only. Never returns SNMP credentials or other secrets."
  );

  readTool(
    "get_device_health", "Device", tools.getDeviceHealth,
    { deviceId: z.string().describe("The device's deviceId, e.g. \"DEV-4821\" (from search_devices).") },
    "Retrieve the current health and monitoring state of one network device (reachability, uptime signal, CPU/memory if collected, last poll time). Read-only."
  );

  readTool(
    "get_device_interfaces", "Device", tools.getDeviceInterfaces,
    { deviceId: z.string().describe("The device's deviceId, e.g. \"DEV-4821\".") },
    "List every network interface on one device with its operational/admin state, speed, duplex, utilization, and error/discard counts. Read-only."
  );

  readTool(
    "get_interface_health", "Device", tools.getInterfaceHealth,
    {
      deviceId: z.string().describe("The device's deviceId, e.g. \"DEV-4821\"."),
      ifIndex: z.number().describe("The interface's ifIndex, from get_device_interfaces.")
    },
    "Get detailed health for ONE interface on a device: current operational state, utilization, input/output traffic and error/discard rates, plus up to the last 10 recent samples over the last 3 hours. Read-only."
  );

  readTool(
    "get_active_incidents", "Incident", tools.getActiveIncidents,
    {
      severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Restrict to this severity."),
      device: z.string().optional().describe("Case-insensitive substring match against the affected device name."),
      limit: z.number().optional().describe("Maximum incidents to return (default 20, max 100).")
    },
    "List currently active (non-resolved) incidents in the current realm, optionally filtered by severity or a device name substring. Read-only."
  );

  readTool(
    "get_incident", "Incident", tools.getIncident,
    { incidentId: z.string().describe("The incident's incidentId, e.g. \"NET-4821\".") },
    "Get full safe details for one incident by incidentId: severity, status, affected device, description, timeline, escalation level, assigned technician, SLA state, and correlated child incidents. Read-only."
  );

  readTool(
    "investigate_incident", "Incident", tools.investigateIncident,
    { incidentId: z.string().describe("The incident's incidentId, e.g. \"NET-4821\".") },
    "Run a full investigation of one incident: root cause analysis, blast radius, correlated sibling incidents, historical similar-incident matches, possible configuration-change cause, SLA status, recommended next actions, and a 0-1 confidence score. This is the primary tool for answering \"why is X happening\". Read-only; does not create or change anything."
  );

  readTool(
    "get_network_topology", "Topology", tools.getNetworkTopology,
    { deviceId: z.string().optional().describe("Optional: a deviceId to focus the graph on that device and its direct neighbors only.") },
    "Get the network topology graph (nodes = devices, edges = discovered neighbor links) for the current realm. Pass deviceId to narrow the result to one device plus its direct neighbors. Read-only."
  );

  readTool(
    "find_available_technicians", "Technician", tools.findAvailableTechnicians,
    {
      skill: z.string().optional().describe("Case-insensitive keyword matched against the technician's role title, e.g. \"senior\" or \"network\"."),
      level: z.number().optional().describe("Exact escalation level (1, 2 or 3).")
    },
    "List active technicians/engineers in the current realm available for escalation, optionally filtered by escalation level or a skill keyword. Read-only."
  );

  readTool(
    "get_technician", "Technician", tools.getTechnician,
    { technicianId: z.string().describe("The technician's technicianId, from find_available_technicians.") },
    "Retrieve safe profile information (name, phone, role, escalation level, whether they have dashboard login access) for one technician. Never returns a password or login token. Read-only."
  );

  return server;
}

export default function mcpRoutes() {
  const router = express.Router();

  router.post("/", requireMcpAuth, async (req, res) => {
    const server = buildServer(req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request handling error:", error);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  // Stateless mode (sessionIdGenerator: undefined above) - there is no
  // server-held session to stream events to or terminate, so GET/DELETE
  // (meaningful only in stateful mode per the MCP Streamable HTTP spec)
  // aren't supported here.
  router.get("/", requireMcpAuth, (req, res) => res.status(405).json({ error: "Method not allowed. This server operates in stateless mode - use POST." }));
  router.delete("/", requireMcpAuth, (req, res) => res.status(405).json({ error: "Method not allowed. This server operates in stateless mode." }));

  return router;
}
