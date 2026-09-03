// Pure tool-handler functions for the 10 read-only WebMCP tools - the exact
// same logic that used to live inline in webmcpRoutes.js's Express handlers,
// extracted so it has exactly ONE implementation shared by both callers:
//
//   - webmcpRoutes.js  (GET /api/webmcp/* - cookie-authed, same browser tab
//     as the human dashboard)
//   - mcpRoutes.js     (POST/GET/DELETE /mcp - Bearer-token-authed, the
//     remote MCP bridge for ChatGPT - see docs/WEBMCP.md)
//
// Each function takes { realmId, ...params } (realmId already resolved by
// whichever auth middleware ran - attachRealmScope for the browser path,
// mcpAuthMiddleware for the remote path - never re-derived here) and either
// returns the same JSON-shaped success payload the routes always returned,
// or throws ToolError (webmcpService.js) for a caller to translate into its
// own error envelope. No new intelligence logic here, same as before - every
// computed fact still comes from the existing services imported below.
import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import Technician from "../models/Technician.js";
import InterfaceSample from "../models/InterfaceSample.js";
import { correlateActiveIncidents, incidentDeviceMatches } from "./incidentCorrelationService.js";
import { computeRootCause } from "./rootCauseService.js";
import { mergeDownstream, computeBlastRadius } from "./blastRadiusService.js";
import { computeRecommendedActions } from "./recommendedActionsService.js";
import { computeRemediationCatalog } from "./remediationService.js";
import { findSimilarIncidents } from "./historicalMatchService.js";
import { findPossibleChangeCause } from "./changeCorrelationService.js";
import { computeSlaStatus } from "./escalationPolicyService.js";
import { MAX_LEVEL } from "./incidentService.js";
import { discoverTopology } from "./topologyService.js";
import { sanitizeDevice, sanitizeDeviceHealth, sanitizeInterface, sanitizeTechnician, sanitizeIncidentSummary, sanitizeIncidentDetail, ToolError } from "./webmcpService.js";

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

// ---- Discovery / monitoring ------------------------------------------------

export async function searchDevices({ realmId, query, status, type }) {
  const filter = { realmId };
  if (status) filter.status = String(status).toUpperCase();
  if (type) filter.deviceType = String(type).toLowerCase();
  if (query) {
    const pattern = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ hostname: pattern }, { ipAddress: pattern }, { vendor: pattern }, { model: pattern }, { deviceId: pattern }];
  }
  const devices = await Device.find(filter).sort({ hostname: 1 }).limit(25).lean();
  return { success: true, count: devices.length, devices: devices.map(sanitizeDevice) };
}

export async function getDeviceHealth({ realmId, deviceId }) {
  const device = await Device.findOne({ deviceId, realmId }).lean();
  if (!device) throw new ToolError(404, "DEVICE_NOT_FOUND", `Device ${deviceId} was not found in the current realm.`);
  return { success: true, health: sanitizeDeviceHealth(device) };
}

export async function getDeviceInterfaces({ realmId, deviceId }) {
  const device = await Device.findOne({ deviceId, realmId }).lean();
  if (!device) throw new ToolError(404, "DEVICE_NOT_FOUND", `Device ${deviceId} was not found in the current realm.`);
  return { success: true, deviceId: device.deviceId, hostname: device.hostname, count: (device.interfaces || []).length, interfaces: (device.interfaces || []).map(sanitizeInterface) };
}

export async function getInterfaceHealth({ realmId, deviceId, ifIndex }) {
  const parsedIfIndex = Number(ifIndex);
  if (!Number.isInteger(parsedIfIndex) || parsedIfIndex < 1) throw new ToolError(400, "INVALID_INTERFACE_INDEX", "ifIndex must be a positive integer.");

  const device = await Device.findOne({ deviceId, realmId }).lean();
  if (!device) throw new ToolError(404, "DEVICE_NOT_FOUND", `Device ${deviceId} was not found in the current realm.`);
  const iface = (device.interfaces || []).find(item => Number(item.ifIndex) === parsedIfIndex);
  if (!iface) throw new ToolError(404, "INTERFACE_NOT_FOUND", `Interface ${parsedIfIndex} was not found on ${device.hostname}.`);

  const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const recentSamples = await InterfaceSample.find({ realmId, deviceId: device.deviceId, ifIndex: parsedIfIndex, sampledAt: { $gte: since } })
    .sort({ sampledAt: -1 }).limit(10).select("status utilizationPercent inBps outBps inErrors outErrors errorRatePerMin discardRatePerMin health sampledAt").lean();

  return {
    success: true,
    deviceId: device.deviceId,
    hostname: device.hostname,
    interface: sanitizeInterface(iface),
    recentSamples: recentSamples.reverse()
  };
}

// ---- Incident intelligence --------------------------------------------------

export async function getActiveIncidents({ realmId, severity, device, limit }) {
  const parsedLimit = Math.min(Math.max(Number.parseInt(limit ?? "20", 10) || 20, 1), 100);
  const filter = { realmId, status: { $ne: "RESOLVED" } };
  if (severity) filter.severity = String(severity).toLowerCase();
  if (device) filter.device = new RegExp(escapeRegex(device), "i");

  const incidents = await Incident.find(filter).sort({ createdAt: -1 }).limit(parsedLimit).lean();
  return { success: true, count: incidents.length, incidents: incidents.map(sanitizeIncidentSummary) };
}

export async function getIncident({ realmId, incidentId }) {
  const { incident, device } = await loadIncidentAndDevice(incidentId, realmId);
  if (!incident) throw new ToolError(404, "INCIDENT_NOT_FOUND", `Incident ${incidentId} was not found in the current realm.`);

  const children = await loadCorrelationChildren(incident, realmId);
  const [sla, rootCause] = [
    computeSlaStatus(incident, { maxLevel: MAX_LEVEL }),
    computeRootCause(incident, { device, children: children.map(c => ({ hostname: c.device, interfaceName: c.interfaceName, createdAt: c.createdAt })) })
  ];

  return {
    success: true,
    incident: sanitizeIncidentDetail(incident),
    device: device ? sanitizeDevice(device) : null,
    sla,
    rootCause,
    correlatedChildren: children.map(c => ({ incidentId: c.incidentId, device: c.device, interfaceName: c.interfaceName }))
  };
}

// The high-value orchestration tool: bundles every existing intelligence
// service's output for one incident into a single agent-optimized response.
export async function investigateIncident({ realmId, incidentId }) {
  const { incident, device, devices } = await loadIncidentAndDevice(incidentId, realmId);
  if (!incident) throw new ToolError(404, "INCIDENT_NOT_FOUND", `Incident ${incidentId} was not found in the current realm.`);

  const deviceById = new Map(devices.map(d => [d.deviceId, d]));
  const childDocs = await loadCorrelationChildren(incident, realmId);
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

  let correlationGroup = null;
  try {
    const correlation = await correlateActiveIncidents({ realmId });
    correlationGroup = (correlation.groups || []).find(g => g.rootIncidentId === incident.incidentId || g.correlationGroupId === incident.correlationGroupId) || null;
  } catch (correlationError) {
    console.warn("WEBMCP investigate_incident correlation warning:", correlationError.message);
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    incident: sanitizeIncidentDetail(incident),
    device: device ? sanitizeDevice(device) : null,
    correlation: correlationGroup ? { correlationGroupId: correlationGroup.correlationGroupId, children: correlationGroup.children, confidence: correlationGroup.children?.[0]?.confidence ?? null } : { correlationGroupId: incident.correlationGroupId || null, children: childRefs.map(c => ({ hostname: c.hostname, interfaceName: c.interfaceName })) },
    sla,
    rootCause,
    blastRadius,
    historicalMatches: similarIncidents,
    possibleChangeCause,
    recommendedActions,
    remediationCatalog,
    confidence: typeof rootCause?.confidence === "number" ? rootCause.confidence / 100 : null
  };
}

// ---- Topology ----------------------------------------------------------------

export async function getNetworkTopology({ realmId, deviceId }) {
  const topology = await discoverTopology(realmId);
  if (!deviceId) return topology;

  const neighborIds = new Set();
  const edges = (topology.edges || []).filter(edge => {
    const touches = edge.source === deviceId || edge.target === deviceId;
    if (touches) { neighborIds.add(edge.source); neighborIds.add(edge.target); }
    return touches;
  });
  const nodes = (topology.nodes || []).filter(node => node.id === deviceId || neighborIds.has(node.id));
  return { ...topology, nodes, edges, focusedOn: deviceId };
}

// ---- Technicians ----------------------------------------------------------------

export async function findAvailableTechnicians({ realmId, level, skill }) {
  const filter = { realmId, active: true };
  if (level) filter.level = Number(level);
  let technicians = await Technician.find(filter).sort({ level: 1, name: 1 }).lean();
  if (skill) {
    const pattern = new RegExp(escapeRegex(skill), "i");
    technicians = technicians.filter(t => pattern.test(t.role || ""));
  }
  return { success: true, count: technicians.length, technicians: technicians.map(sanitizeTechnician) };
}

export async function getTechnician({ realmId, technicianId }) {
  const technician = await Technician.findOne({ technicianId, realmId }).lean();
  if (!technician) throw new ToolError(404, "TECHNICIAN_NOT_FOUND", `Technician ${technicianId} was not found in the current realm.`);
  return { success: true, technician: sanitizeTechnician(technician) };
}

export default {
  searchDevices, getDeviceHealth, getDeviceInterfaces, getInterfaceHealth,
  getActiveIncidents, getIncident, investigateIncident,
  getNetworkTopology, findAvailableTechnicians, getTechnician
};
