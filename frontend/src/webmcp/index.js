// Entry point for NetEscalate's WebMCP tool layer. Mounted once from
// App.jsx (see the useEffect there) once the logged-in user is known.
//
// `import "@mcp-b/global"` is what actually makes document.modelContext
// exist in this tab: it installs the real W3C WebMCP
// (https://webmachinelearning.github.io/webmcp/) `document.modelContext`
// API - using the browser's native implementation if present, otherwise a
// spec-compliant polyfill - and bridges it so any MCP-compatible client
// (Claude, ChatGPT, Gemini, an MCP browser extension, etc.) can discover
// and call the tools registered below. This is the real API, not a
// look-alike - see docs/WEBMCP.md.
import "@mcp-b/global";
import { beginRegistration } from "./toolRegistry.js";
import { resolveToolGroups } from "./agentContext.js";
import { registerDeviceTools } from "./deviceTools.js";
import { registerIncidentTools } from "./incidentTools.js";
import { registerTechnicianTools } from "./technicianTools.js";
import { registerTopologyTools } from "./topologyTools.js";
import { registerPlatformTools } from "./platformTools.js";

let activeController = null;

export async function initWebMCP(user) {
  await teardownWebMCP();

  const groups = resolveToolGroups(user);
  if (!groups.tenant && !groups.platform) return;

  activeController = beginRegistration();
  const registrations = [];
  if (groups.tenant) registrations.push(registerDeviceTools(), registerIncidentTools(), registerTechnicianTools(), registerTopologyTools());
  if (groups.platform) registrations.push(registerPlatformTools());

  try {
    await Promise.all(registrations);
    console.info("[webmcp] Tools registered:", { tenant: groups.tenant, platform: groups.platform });
  } catch (error) {
    console.error("[webmcp] Tool registration failed:", error);
  }
}

export async function teardownWebMCP() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

export { subscribeActivity, getActivitySnapshot, resolveApproval, hasPendingApprovals } from "./security.js";
