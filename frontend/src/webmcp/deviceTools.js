// Discovery/monitoring WebMCP tools - all read-only. See docs/WEBMCP.md for
// the read-only vs consequential split. Every value returned here is a
// sanitized projection built server-side (backend/src/services/webmcpService.js)
// - SNMP community strings/keys are stripped before this code ever sees them.
import { registerReadTool } from "./toolRegistry.js";
import { searchDevices, getDeviceHealth, getDeviceInterfaces, getInterfaceHealth } from "../services/webmcpApi.js";

export async function registerDeviceTools() {
  await registerReadTool({
    name: "search_devices",
    description:
      "Find network devices (routers, switches, firewalls, servers, access points) in the current user's realm by hostname, IP address, vendor or model, optionally filtered by monitoring status or device type. Use this first when investigating a problem described by device name or symptom (e.g. \"Core-Router-01\"). Read-only. Never returns SNMP credentials or other secrets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text match against hostname, IP address, vendor or model. Omit to list devices matching only the filters below." },
        status: { type: "string", enum: ["UP", "DOWN", "DEGRADED", "UNKNOWN"], description: "Restrict to devices currently in this monitoring status." },
        type: { type: "string", enum: ["router", "switch", "firewall", "server", "access-point", "printer", "other"], description: "Restrict to this device type." }
      }
    },
    run: args => searchDevices(args),
    summarize: (args, result) => `Searched devices${args?.query ? ` for "${args.query}"` : ""}${result ? ` — ${result.count} match(es)` : ""}`
  });

  await registerReadTool({
    name: "get_device_health",
    description:
      "Retrieve the current health and monitoring state of one network device (reachability, uptime signal, CPU/memory if collected, last poll time). Use this when investigating whether a specific device itself is the source of a problem, before looking at its individual interfaces. Read-only.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", description: "The device's deviceId, e.g. \"DEV-4821\" (from search_devices)." } }, required: ["deviceId"] },
    run: ({ deviceId }) => getDeviceHealth(deviceId),
    summarize: args => `Checked health of ${args?.deviceId}`
  });

  await registerReadTool({
    name: "get_device_interfaces",
    description:
      "List every network interface on one device with its operational/admin state, speed, duplex, utilization, and error/discard counts. Use this to find which specific interface (e.g. a WAN uplink) is degraded before drilling into get_interface_health. Read-only.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", description: "The device's deviceId, e.g. \"DEV-4821\"." } }, required: ["deviceId"] },
    run: ({ deviceId }) => getDeviceInterfaces(deviceId),
    summarize: (args, result) => `Inspected ${result ? result.count : "?"} interface(s) on ${args?.deviceId}`
  });

  await registerReadTool({
    name: "get_interface_health",
    description:
      "Get detailed health for ONE interface on a device: current operational state, utilization, input/output traffic and error/discard rates, plus up to the last 10 recent samples over the last 3 hours. Use this once get_device_interfaces has identified a suspect interface, to confirm a trend (e.g. rising errors) rather than a single noisy reading. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string", description: "The device's deviceId, e.g. \"DEV-4821\"." },
        ifIndex: { type: "number", description: "The interface's ifIndex, from get_device_interfaces." }
      },
      required: ["deviceId", "ifIndex"]
    },
    run: ({ deviceId, ifIndex }) => getInterfaceHealth(deviceId, ifIndex),
    summarize: args => `Checked interface ${args?.ifIndex} on ${args?.deviceId}`
  });
}

export default { registerDeviceTools };
