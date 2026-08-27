// Computes an incident's downstream impact: how many/which devices and
// interfaces are affected, which sites, a tiered root->distribution->
// access->endpoints chain built from the existing Device.role field, a
// device-type breakdown standing in for "services potentially affected"
// (this system does not track named business services, so it reasons from
// what it actually knows rather than inventing telemetry), and the
// upstream device this one itself depends on. Computed on demand from
// already-loaded Incident/Device data - no new persisted model, mirroring
// rootCauseService.js.

const TIER_ORDER = ["core", "edge", "access", "host"];
const TIER_LABEL = { core: "CORE", edge: "DISTRIBUTION", access: "ACCESS", host: "ENDPOINTS" };

// Combines the two independent sources of "devices downstream of this
// incident": the real-time parentDeviceId cascade (Incident.impactedDevices)
// and topology-correlation group children. A device can appear in either or
// both; dedupe by deviceId (falling back to hostname for entries without one).
export function mergeDownstream(correlationChildren = [], impactedDevices = []) {
  const seen = new Set();
  const merged = [];
  for (const entry of [
    ...correlationChildren,
    ...impactedDevices.map(d => ({ deviceId: d.deviceId, hostname: d.hostname, interfaceName: null }))
  ]) {
    const key = entry.deviceId || entry.hostname;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

// downstream: [{ deviceId, hostname, interfaceName }]. deviceById resolves
// deviceId -> full Device doc for role/location/status enrichment where available.
export function computeBlastRadius(incident, { rootDevice, downstream = [], deviceById = new Map() } = {}) {
  const resolved = downstream.map(entry => ({ ...entry, device: entry.deviceId ? deviceById.get(entry.deviceId) : null }));

  const affectedDevices = [rootDevice?.hostname || incident.device, ...resolved.map(e => e.device?.hostname || e.hostname)].filter(Boolean);
  const affectedInterfaces = [incident.interfaceName, ...resolved.map(e => e.interfaceName)].filter(Boolean);
  const sitesAffected = [rootDevice?.location, ...resolved.map(e => e.device?.location)].filter(Boolean);

  const tierCounts = new Map();
  for (const entry of resolved) if (entry.device?.role) tierCounts.set(entry.device.role, (tierCounts.get(entry.device.role) || 0) + 1);
  const chain = [
    { tier: "ROOT", label: rootDevice?.hostname || incident.device, count: 1 },
    ...TIER_ORDER.filter(tier => tierCounts.has(tier)).map(tier => ({ tier: TIER_LABEL[tier], label: null, count: tierCounts.get(tier) }))
  ];

  const typeCounts = new Map();
  for (const entry of resolved) if (entry.device?.deviceType) typeCounts.set(entry.device.deviceType, (typeCounts.get(entry.device.deviceType) || 0) + 1);
  const servicesPotentiallyAffected = [...typeCounts.entries()].map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`);

  const upstreamDevice = rootDevice?.parentDeviceId ? deviceById.get(rootDevice.parentDeviceId) || null : null;

  return {
    affectedDeviceCount: new Set(affectedDevices).size,
    affectedDevices: [...new Set(affectedDevices)],
    affectedInterfaceCount: new Set(affectedInterfaces).size,
    affectedInterfaces: [...new Set(affectedInterfaces)],
    sitesAffected: [...new Set(sitesAffected)],
    servicesPotentiallyAffected,
    upstreamDevice: upstreamDevice ? { deviceId: upstreamDevice.deviceId, hostname: upstreamDevice.hostname, status: upstreamDevice.status } : null,
    downstreamDevices: resolved.map(e => ({ deviceId: e.deviceId || e.device?.deviceId || null, hostname: e.device?.hostname || e.hostname, interfaceName: e.interfaceName || null, role: e.device?.role || null, status: e.device?.status || null })),
    chain
  };
}

export default { mergeDownstream, computeBlastRadius };
