import Incident from "../models/Incident.js";
import Device from "../models/Device.js";
import { discoverTopology } from "./topologyService.js";

const MAX_CORRELATION_HOPS = 3;
const ACTIVE_STATUSES = new Set(["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "FAILED"]);
const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };

let topologyCache = { value: null, expiresAt: 0 };

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function incidentDeviceMatches(incident, device) {
  const candidates = [device.deviceId, device.hostname, device.ipAddress].map(normalize).filter(Boolean);
  const target = normalize(incident.device);
  return Boolean(target && candidates.some(candidate => candidate === target || candidate.includes(target) || target.includes(candidate)));
}

async function getTopologyCached(force = false) {
  const now = Date.now();
  if (!force && topologyCache.value && topologyCache.expiresAt > now) return topologyCache.value;
  const topology = await discoverTopology();
  topologyCache = { value: topology, expiresAt: now + 30_000 };
  return topology;
}

function buildGraph(edges = []) {
  const graph = new Map();
  const add = (from, edge) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(edge);
  };
  for (const edge of edges) {
    add(edge.source, { edge, next: edge.target });
    add(edge.target, { edge, next: edge.source });
  }
  return graph;
}

function shortestPath(graph, source, target) {
  if (!source || !target) return null;
  if (source === target) return { hops: 0, edges: [] };
  const queue = [{ node: source, hops: 0, edges: [] }];
  const visited = new Set([source]);
  while (queue.length) {
    const current = queue.shift();
    if (current.hops >= MAX_CORRELATION_HOPS) continue;
    for (const next of graph.get(current.node) || []) {
      if (visited.has(next.next)) continue;
      const edges = [...current.edges, next.edge];
      if (next.next === target) return { hops: current.hops + 1, edges };
      visited.add(next.next);
      queue.push({ node: next.next, hops: current.hops + 1, edges });
    }
  }
  return null;
}

function scoreRelationship(root, child, path, rootDevice, childDevice) {
  let score = 0;
  const evidence = [];
  if (rootDevice?.status === "DOWN") { score += 35; evidence.push(`${rootDevice.hostname} is DOWN`); }
  if (childDevice?.status === "DOWN") { score += 15; evidence.push(`${childDevice.hostname} is DOWN`); }
  if (root.severity === "critical") { score += 20; evidence.push("root incident is critical"); }
  if (child.source === "DEVICE_MONITOR" || child.source === "INTERFACE_HEALTH") { score += 10; evidence.push("child is automatically detected"); }
  if (path?.hops === 1) { score += 25; evidence.push("devices are directly adjacent in topology"); }
  else if (path?.hops === 2) { score += 15; evidence.push("devices are two topology hops apart"); }
  else if (path?.hops === 3) { score += 8; evidence.push("devices are within three topology hops"); }
  if (new Date(child.createdAt || 0) >= new Date(root.createdAt || 0)) { score += 10; evidence.push("child incident started after root incident"); }
  return { score: Math.min(100, score), evidence };
}

function chooseRoots(incidents, deviceByIncident) {
  return [...incidents].sort((a, b) => {
    const aDevice = deviceByIncident.get(a.incidentId);
    const bDevice = deviceByIncident.get(b.incidentId);
    const aDown = aDevice?.status === "DOWN" ? 0 : 1;
    const bDown = bDevice?.status === "DOWN" ? 0 : 1;
    return aDown - bDown || (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
}

export async function correlateActiveIncidents({ forceTopology = false } = {}) {
  const incidents = await Incident.find({ status: { $in: [...ACTIVE_STATUSES] } }).sort({ createdAt: 1 }).exec();
  const devices = await Device.find({}).lean().exec();
  const topology = await getTopologyCached(forceTopology);
  const graph = buildGraph(topology?.edges || []);
  const deviceByIncident = new Map();

  for (const incident of incidents) {
    deviceByIncident.set(incident.incidentId, devices.find(device => incidentDeviceMatches(incident, device)) || null);
  }

  const groups = [];
  const assigned = new Set();
  const orderedRoots = chooseRoots(incidents, deviceByIncident);

  for (const root of orderedRoots) {
    if (assigned.has(root.incidentId)) continue;
    const rootDevice = deviceByIncident.get(root.incidentId);
    if (!rootDevice) continue;

    const children = [];
    for (const child of incidents) {
      if (child.incidentId === root.incidentId || assigned.has(child.incidentId)) continue;
      const childDevice = deviceByIncident.get(child.incidentId);
      if (!childDevice || childDevice.deviceId === rootDevice.deviceId) continue;
      const path = shortestPath(graph, rootDevice.deviceId, childDevice.deviceId);
      if (!path || path.hops < 1 || path.hops > MAX_CORRELATION_HOPS) continue;
      const relationship = scoreRelationship(root, child, path, rootDevice, childDevice);
      if (relationship.score < 55) continue;
      children.push({ child, childDevice, path, ...relationship });
    }

    if (!children.length) continue;

    const correlationGroupId = `COR-${root.incidentId}`;
    assigned.add(root.incidentId);
    root.correlationGroupId = correlationGroupId;
    root.correlationRole = "ROOT";
    root.parentIncidentId = null;
    root.correlationConfidence = 100;
    root.correlationEvidence = ["Selected as the earliest/highest-severity active fault explaining downstream symptoms.", ...(rootDevice.status === "DOWN" ? [`${rootDevice.hostname} is DOWN.`] : [])];
    await root.save();

    const groupChildren = [];
    for (const relation of children.sort((a, b) => b.score - a.score)) {
      assigned.add(relation.child.incidentId);
      relation.child.correlationGroupId = correlationGroupId;
      relation.child.correlationRole = "CHILD";
      relation.child.parentIncidentId = root.incidentId;
      relation.child.correlationConfidence = relation.score;
      relation.child.correlationEvidence = relation.evidence;
      await relation.child.save();
      groupChildren.push({
        incidentId: relation.child.incidentId,
        device: relation.child.device,
        hops: relation.path.hops,
        confidence: relation.score,
        evidence: relation.evidence,
        path: relation.path.edges.map(edge => ({ source: edge.source, target: edge.target, protocol: edge.protocol, sourceInterface: edge.sourceInterface, targetInterface: edge.targetInterface, state: edge.state }))
      });
    }

    groups.push({
      correlationGroupId,
      rootIncidentId: root.incidentId,
      rootDevice: root.device,
      rootSeverity: root.severity,
      children: groupChildren,
      blastRadius: groupChildren.length
    });
  }

  const correlatedIds = new Set(groups.flatMap(group => [group.rootIncidentId, ...group.children.map(child => child.incidentId)]));
  for (const incident of incidents) {
    if (correlatedIds.has(incident.incidentId)) continue;
    if (incident.correlationGroupId || incident.correlationRole || incident.parentIncidentId) {
      incident.correlationGroupId = null;
      incident.correlationRole = "STANDALONE";
      incident.parentIncidentId = null;
      incident.correlationConfidence = null;
      incident.correlationEvidence = [];
      await incident.save();
    }
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    topologyGeneratedAt: topology?.generatedAt || null,
    activeIncidents: incidents.length,
    correlatedGroups: groups.length,
    suppressedChildren: groups.reduce((total, group) => total + group.children.length, 0),
    groups,
    incidents: incidents.map(incident => incident.toObject())
  };
}

export function invalidateIncidentCorrelationTopologyCache() {
  topologyCache = { value: null, expiresAt: 0 };
}

export default { correlateActiveIncidents, invalidateIncidentCorrelationTopologyCache };
