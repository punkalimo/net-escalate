// Platform-Super-Admin-only WebMCP tools - a deliberately small, separate
// set from the tenant tools above (deviceTools.js/incidentTools.js/...).
// Only registered when agentContext.resolveToolGroups() says `platform` is
// true (i.e. the logged-in user has a platformRole - see App.jsx). The
// backend independently re-verifies platform authority on every call via
// requirePlatform (see server.js's `/api/platform` mount) - registration
// here is just "don't advertise a tool this user could never successfully
// call," never the actual authorization check.
//
// Reuses the existing platform console's own REST endpoints directly
// (GET /api/platform/realms, GET /api/platform/realms/:id) rather than
// duplicating that aggregation logic - see platformRoutes.js.
import { registerReadTool } from "./toolRegistry.js";
import { getRealms, getRealm } from "../services/platformApi.js";

export async function registerPlatformTools() {
  await registerReadTool({
    name: "list_realms",
    description:
      "PLATFORM ADMIN ONLY. List every realm (tenant organization) on this NetEscalate instance with aggregated device/technician/incident counts. Use this to get a cross-realm overview before drilling into one realm with get_realm_overview. Read-only.",
    inputSchema: { type: "object", properties: { search: { type: "string", description: "Optional case-insensitive substring match against realm name." }, status: { type: "string", enum: ["active", "suspended", "disabled"] } } },
    run: args => getRealms(args),
    summarize: (args, result) => `Listed realms${result ? ` — ${result.realms?.length ?? "?"} found` : ""}`
  });

  await registerReadTool({
    name: "get_realm_overview",
    description:
      "PLATFORM ADMIN ONLY. Get a high-level operational overview for one realm: device/technician/incident counts plus the same incident-overview rollup (active/critical/SLA-breach counts, top root causes) a realm operator sees on their own dashboard. Does not return tenant secrets. Read-only.",
    inputSchema: { type: "object", properties: { realmId: { type: "string", description: "The realm's MongoDB id, from list_realms." } }, required: ["realmId"] },
    run: ({ realmId }) => getRealm(realmId),
    summarize: args => `Retrieved realm overview for ${args?.realmId}`
  });
}

export default { registerPlatformTools };
