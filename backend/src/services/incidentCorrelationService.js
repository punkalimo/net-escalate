import Incident from "../models/Incident.js";
import Device from "../models/Device.js";
import Realm from "../models/Realm.js";
import { discoverTopology } from "./topologyService.js";
import { computeRootCause } from "./rootCauseService.js";
import { mergeDownstream, computeBlastRadius } from "./blastRadiusService.js";
import { pushTimelineEvent } from "./timelineService.js";
import { emitToRealm } from "./realtimeService.js";

const MAX_CORRELATION_HOPS = 3;
const ACTIVE_STATUSES = new Set(["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "FAILED"]);
const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };

// Keyed per-realm - a single shared cache would let one realm's correlation
// pass match against another realm's topology edges (a real cross-tenant
// leak, not just a performance detail).
const topologyCacheByRealm = new Map();

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Exact deviceId match first - every DEVICE_MONITOR/INTERFACE_HEALTH/SYSTEM_HEALTH
// incident carries one. Fuzzy label matching is only a fallback for MANUAL
// incidents, which have no deviceId to anchor to.
export function incidentDeviceMatches(incident, device) {
  if (incident.deviceId) return incident.deviceId === device.deviceId;
  const candidates = [device.deviceId, device.hostname, device.ipAddress].map(normalize).filter(Boolean);
  const target = normalize(incident.device);
  return Boolean(target && candidates.some(candidate => candidate === target || candidate.includes(target) || target.includes(candidate)));
}

async function getTopologyCached(realmId, force = false) {
  const key = String(realmId);
  const now = Date.now();
  const cached = topologyCacheByRealm.get(key);
  if (!force && cached?.value && cached.expiresAt > now) return cached.value;
  const topology = await discoverTopology(realmId);
  topologyCacheByRealm.set(key, { value: topology, expiresAt: now + 30_000 });
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

// Pure, in-memory ancestor walk over the already-loaded device list - reuses
// the same parentDeviceId hierarchy the real-time device-monitor suppression
// mechanism (deviceMonitoringService.js) relies on, without any extra DB
// round-trips inside the correlation loop.
export function isDeviceAncestor(rootDeviceId, childDevice, deviceById, maxHops = 10) {
  let current = childDevice;
  const visited = new Set([childDevice?.deviceId]);
  for (let hops = 0; hops < maxHops && current?.parentDeviceId; hops += 1) {
    if (current.parentDeviceId === rootDeviceId) return true;
    if (visited.has(current.parentDeviceId)) break;
    visited.add(current.parentDeviceId);
    current = deviceById.get(current.parentDeviceId);
  }
  return false;
}

function scoreRelationship(root, child, path, rootDevice, childDevice, deviceById) {
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
  if (deviceById && rootDevice && childDevice && isDeviceAncestor(rootDevice.deviceId, childDevice, deviceById)) { score += 20; evidence.push(`${childDevice.hostname} is a known descendant of ${rootDevice.hostname} (parentDeviceId chain)`); }
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

// Group id is keyed off the root DEVICE, not the root incident. Which
// incident is "root" can flip between sweeps as severity escalation
// (severityService.js) reorders chooseRoots() - keying off the incidentId
// would silently rename the group on every flip and break anything keyed on
// it (React list keys, the manual-lock mechanism below). The device rarely
// changes, so the id stays stable across the incident's whole lifetime.
export function computeCorrelationGroupId(rootDevice, rootIncident) {
  return rootDevice?.deviceId ? `COR-${rootDevice.deviceId}` : `COR-${rootIncident.incidentId}`;
}

// Incidents a NOC engineer has manually merged/unmerged are frozen: the
// sweep never reselects them as a root, never attaches new automatic
// children to them, and never resets their grouping in the cleanup pass.
export function partitionManualIncidents(incidents) {
  const manual = incidents.filter(incident => incident.correlationManual);
  const automatic = incidents.filter(incident => !incident.correlationManual);
  return { manual, automatic };
}

async function resetStandaloneIfNeeded(incident) {
  if (incident.correlationManual) return false;
  if (!incident.correlationGroupId && incident.correlationRole === "STANDALONE" && !incident.parentIncidentId) return false;
  incident.correlationGroupId = null;
  incident.correlationRole = "STANDALONE";
  incident.parentIncidentId = null;
  incident.correlationConfidence = null;
  incident.correlationEvidence = [];
  await incident.save();
  return true;
}

// Manually-merged groups are already fully formed on the Incident docs
// (set directly by the merge endpoint) - no topology/scoring work needed to
// surface them, just read them back into the same `groups` shape the UI
// expects so RootCauseCenter/IncidentDetails render them alongside
// automatically-discovered groups.
function buildManualGroups(incidents, devices = []) {
  const groups = [];
  const deviceById = new Map(devices.map(device => [device.deviceId, device]));
  const roots = incidents.filter(incident => incident.correlationManual && incident.correlationRole === "ROOT" && incident.correlationGroupId);
  for (const root of roots) {
    const children = incidents.filter(incident => incident.correlationRole === "CHILD" && incident.correlationGroupId === root.correlationGroupId);
    if (!children.length) continue;
    const rootDevice = devices.find(device => incidentDeviceMatches(root, device)) || null;
    const childRefs = children.map(child => {
      const childDevice = devices.find(device => incidentDeviceMatches(child, device)) || null;
      return { deviceId: childDevice?.deviceId || null, hostname: childDevice?.hostname || child.device, interfaceName: child.interfaceName, createdAt: child.createdAt };
    });
    const downstream = mergeDownstream(childRefs, root.impactedDevices);
    groups.push({
      correlationGroupId: root.correlationGroupId,
      rootIncidentId: root.incidentId,
      rootDevice: root.device,
      rootSeverity: root.severity,
      manual: true,
      children: children.map(child => ({ incidentId: child.incidentId, device: child.device, hops: null, confidence: child.correlationConfidence ?? null, evidence: child.correlationEvidence || [], path: [] })),
      blastRadius: children.length,
      rootCause: computeRootCause(root, { device: rootDevice, children: childRefs }),
      blastRadiusDetail: computeBlastRadius(root, { rootDevice, downstream, deviceById })
    });
  }
  return groups;
}

async function runCorrelation({ realmId, forceTopology = false } = {}) {
  const incidents = await Incident.find({ realmId, status: { $in: [...ACTIVE_STATUSES] } }).sort({ createdAt: 1 }).exec();

  // Nothing to correlate with 0-1 active incidents - skip the SNMP-based
  // topology discovery entirely so an idle network never pays for it, and
  // this also shrinks the window where a sweep could collide with someone
  // browsing the Topology page.
  if (incidents.length < 2) {
    for (const incident of incidents) await resetStandaloneIfNeeded(incident);
    const devices = incidents.length ? await Device.find({ realmId }).lean().exec() : [];
    const manualGroups = buildManualGroups(incidents, devices);
    return {
      success: true, generatedAt: new Date().toISOString(), topologyGeneratedAt: null,
      activeIncidents: incidents.length, correlatedGroups: manualGroups.length,
      suppressedChildren: manualGroups.reduce((total, group) => total + group.children.length, 0),
      groups: manualGroups, incidents: incidents.map(incident => incident.toObject())
    };
  }

  const devices = await Device.find({ realmId }).lean().exec();
  const deviceById = new Map(devices.map(device => [device.deviceId, device]));
  const topology = await getTopologyCached(realmId, forceTopology);
  const graph = buildGraph(topology?.edges || []);
  const deviceByIncident = new Map();

  for (const incident of incidents) {
    deviceByIncident.set(incident.incidentId, devices.find(device => incidentDeviceMatches(incident, device)) || null);
  }

  const { manual: manualIncidents, automatic: automaticIncidents } = partitionManualIncidents(incidents);

  const groups = [];
  const assigned = new Set(manualIncidents.map(incident => incident.incidentId));
  const orderedRoots = chooseRoots(automaticIncidents, deviceByIncident);

  for (const root of orderedRoots) {
    if (assigned.has(root.incidentId)) continue;
    const rootDevice = deviceByIncident.get(root.incidentId);
    if (!rootDevice) continue;

    const children = [];
    for (const child of automaticIncidents) {
      if (child.incidentId === root.incidentId || assigned.has(child.incidentId)) continue;
      const childDevice = deviceByIncident.get(child.incidentId);
      if (!childDevice || childDevice.deviceId === rootDevice.deviceId) continue;
      const path = shortestPath(graph, rootDevice.deviceId, childDevice.deviceId);
      if (!path || path.hops < 1 || path.hops > MAX_CORRELATION_HOPS) continue;
      const relationship = scoreRelationship(root, child, path, rootDevice, childDevice, deviceById);
      if (relationship.score < 55) continue;
      children.push({ child, childDevice, path, ...relationship });
    }

    if (!children.length) continue;

    const correlationGroupId = computeCorrelationGroupId(rootDevice, root);
    const rootWasAlreadyThisGroup = root.correlationGroupId === correlationGroupId;
    assigned.add(root.incidentId);
    root.correlationGroupId = correlationGroupId;
    root.correlationRole = "ROOT";
    root.parentIncidentId = null;
    root.correlationConfidence = 100;
    root.correlationEvidence = ["Selected as the earliest/highest-severity active fault explaining downstream symptoms.", ...(rootDevice.status === "DOWN" ? [`${rootDevice.hostname} is DOWN.`] : [])];
    if (!rootWasAlreadyThisGroup) pushTimelineEvent(root, "ALERT_CORRELATED", `Identified as the root cause for a ${children.length}-incident correlation group.`, { actor: "correlation engine" });
    await root.save();

    const groupChildren = [];
    for (const relation of children.sort((a, b) => b.score - a.score)) {
      assigned.add(relation.child.incidentId);
      const childWasAlreadyThisGroup = relation.child.correlationGroupId === correlationGroupId;
      relation.child.correlationGroupId = correlationGroupId;
      relation.child.correlationRole = "CHILD";
      relation.child.parentIncidentId = root.incidentId;
      relation.child.correlationConfidence = relation.score;
      relation.child.correlationEvidence = relation.evidence;
      if (!childWasAlreadyThisGroup) pushTimelineEvent(relation.child, "ALERT_CORRELATED", `Correlated as a downstream symptom of ${root.incidentId}.`, { actor: "correlation engine" });
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

    const childRefs = children.map(relation => ({ deviceId: relation.childDevice?.deviceId || null, hostname: relation.childDevice?.hostname || relation.child.device, interfaceName: relation.child.interfaceName, createdAt: relation.child.createdAt }));
    const downstream = mergeDownstream(childRefs, root.impactedDevices);
    groups.push({
      correlationGroupId,
      rootIncidentId: root.incidentId,
      rootDevice: root.device,
      rootSeverity: root.severity,
      children: groupChildren,
      blastRadius: groupChildren.length,
      rootCause: computeRootCause(root, { device: rootDevice, children: childRefs }),
      blastRadiusDetail: computeBlastRadius(root, { rootDevice, downstream, deviceById })
    });
  }

  const correlatedIds = new Set(groups.flatMap(group => [group.rootIncidentId, ...group.children.map(child => child.incidentId)]));
  for (const incident of automaticIncidents) {
    if (correlatedIds.has(incident.incidentId)) continue;
    await resetStandaloneIfNeeded(incident);
  }

  const allGroups = [...groups, ...buildManualGroups(manualIncidents, devices)];

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    topologyGeneratedAt: topology?.generatedAt || null,
    activeIncidents: incidents.length,
    correlatedGroups: allGroups.length,
    suppressedChildren: allGroups.reduce((total, group) => total + group.children.length, 0),
    groups: allGroups,
    incidents: incidents.map(incident => incident.toObject())
  };
}

// Concurrency guard: the sweep timer below and up to 4 existing manual call
// sites (incidentRoutes.js, phase4Routes.js) can now overlap in time. Without
// this memo, two concurrent runs could both load the same Incident docs and
// race their .save() calls into a Mongoose version-conflict error. Keyed per
// realm - a single shared guard would make Realm A's request await (and
// receive!) Realm B's in-flight correlation result, a cross-tenant leak, not
// just a missed-dedup performance detail.
const inFlightByRealm = new Map();

export async function correlateActiveIncidents(opts = {}) {
  const key = String(opts.realmId);
  const existing = inFlightByRealm.get(key);
  if (existing) return existing;
  const promise = runCorrelation(opts).finally(() => { inFlightByRealm.delete(key); });
  inFlightByRealm.set(key, promise);
  return promise;
}

export function invalidateIncidentCorrelationTopologyCache(realmId) {
  if (realmId) topologyCacheByRealm.delete(String(realmId));
  else topologyCacheByRealm.clear();
}

// Runs correlation once per active Realm, sequentially - used only by the
// sweep timer below. Route handlers call correlateActiveIncidents directly
// with the caller's own realmId instead (they already know which realm they're
// scoped to; looping over every realm on every request would be both wrong
// - a realm user must never trigger correlation work on another realm - and
// wasteful).
async function correlateAllRealms() {
  const realms = await Realm.find({ status: "active" }).select("_id").lean();
  for (const realm of realms) {
    try {
      const result = await correlateActiveIncidents({ realmId: realm._id });
      if (global.io) emitToRealm(realm._id, "incident_correlation_updated", result);
    } catch (error) {
      console.error(`[CORRELATION SWEEP] Failed for realm ${realm._id}: ${error.message}`);
    }
  }
}

let sweepTimer = null;
let sweepRunning = false;

export function startIncidentCorrelationSweep(intervalSeconds = 90) {
  stopIncidentCorrelationSweep();
  sweepTimer = setInterval(() => {
    if (sweepRunning) return;
    sweepRunning = true;
    correlateAllRealms()
      .catch(error => console.error(`[CORRELATION SWEEP] Failed: ${error.message}`))
      .finally(() => { sweepRunning = false; });
  }, intervalSeconds * 1000);
  console.log(`[CORRELATION SWEEP] Started, every ${intervalSeconds}s`);
}

export function stopIncidentCorrelationSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export default {
  correlateActiveIncidents,
  invalidateIncidentCorrelationTopologyCache,
  startIncidentCorrelationSweep,
  stopIncidentCorrelationSweep,
  isDeviceAncestor,
  computeCorrelationGroupId,
  partitionManualIncidents,
  incidentDeviceMatches
};
