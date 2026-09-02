// Topology WebMCP tool - read-only. Reuses the existing SNMP CDP/LLDP
// discovery engine (topologyService.js) the human Topology view already
// calls; does not trigger a fresh SNMP walk on every call (see
// docs/WEBMCP.md's performance section).
import { registerReadTool } from "./toolRegistry.js";
import { getNetworkTopology } from "../services/webmcpApi.js";

export async function registerTopologyTools() {
  await registerReadTool({
    name: "get_network_topology",
    description:
      "Get the network topology graph (nodes = devices, edges = discovered CDP/LLDP neighbor links with local/remote interfaces and link state) for the current realm. Pass deviceId to narrow the result to one device plus its direct neighbors - use this to determine whether a device is upstream or downstream of another, e.g. to confirm several affected devices share a common upstream router. Read-only.",
    inputSchema: { type: "object", properties: { deviceId: { type: "string", description: "Optional: a deviceId to focus the graph on that device and its direct neighbors only." } } },
    run: args => getNetworkTopology(args?.deviceId),
    summarize: (args, result) => (args?.deviceId ? `Inspected topology around ${args.deviceId}` : `Loaded network topology${result ? ` — ${result.discovery?.nodes ?? "?"} node(s), ${result.discovery?.links ?? "?"} link(s)` : ""}`)
  });
}

export default { registerTopologyTools };
