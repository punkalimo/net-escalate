import Device from "../models/Device.js";
import InterfaceSample from "../models/InterfaceSample.js";
import DeviceSystemSample from "../models/DeviceSystemSample.js";
import { discoverInterfaces, bulkGetInterfaceOperationalTable, getDeviceSystemMetrics } from "./snmpService.js";
import { evaluateInterfaceHealth, evaluateInterfaceErrorRate, updateFlapWindow, evaluateInterfaceFlap, syncInterfaceIncident, syncInterfaceDegradationIncident, syncInterfaceFlapIncident, FLAP_DEFAULTS } from "./interfaceHealthService.js";
import { evaluateSystemMetricHealth, syncSystemHealthIncident } from "./systemHealthService.js";
import { emitToRealm } from "./realtimeService.js";

// Admin status, interface names/descriptions and speed/duplex are
// config-driven and change rarely, so they're synced on their own slow
// cadence, independent of the fast operational poll below. 10 minutes sits
// in the 5-15 minute range appropriate for that cadence.
const ADMIN_SYNC_INTERVAL_SECONDS = 600;

const monitoringTimers = new Map();

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateRate(current, previous, elapsedSeconds) {
  if (current == null || previous == null || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || current < previous) return null;
  return ((current - previous) * 8) / elapsedSeconds;
}

function calculateUtilization(inBps, outBps, speedMbps) {
  if (inBps == null || outBps == null || speedMbps == null || speedMbps <= 0) return null;
  const capacityBps = speedMbps * 1_000_000;
  return Math.min(100, (Math.max(inBps, outBps) / capacityBps) * 100);
}

// Same shape as calculateRate but for error/discard counters: a plain
// per-minute rate from a counter delta, not multiplied by 8 (these are
// packet/event counts, not octets) and with no capacity to normalise
// against.
function calculateCounterDelta(current, previous) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || current < previous) return null;
  return current - previous;
}

function ratePerMinute(delta, elapsedSeconds) {
  if (delta == null || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
  return (delta / elapsedSeconds) * 60;
}

// Deliberately not `toNumber(a) + toNumber(b)` inline at call sites: when
// both inputs are missing/non-finite, toNumber returns null for each, and
// `null + null` coerces to 0 in JS - not null. That would make a missing
// baseline (e.g. right after discovery, before inErrors/outErrors have
// ever been polled) look like a valid "previous = 0" reading and turn the
// interface's entire lifetime error count into a one-cycle delta.
function sumOrNull(a, b) {
  const na = toNumber(a);
  const nb = toNumber(b);
  return na == null || nb == null ? null : na + nb;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dedupeByIfIndex(interfaces) {
  const byIndex = new Map();
  for (const item of interfaces) byIndex.set(Number(item.ifIndex), item);
  return [...byIndex.values()];
}

function adminStateFromStatus(ifAdminStatus) {
  return ifAdminStatus === 1 ? "UP" : ifAdminStatus === 2 ? "DOWN" : "UNKNOWN";
}

// ifPhysAddress arrives as a bare hex string (e.g. "001122aabbcc") - colon
// notation is the universal display convention and a mismatch/change here
// (a port suddenly reporting a different MAC) is itself a useful
// troubleshooting signal, so it's worth formatting once at the source
// rather than leaving every consumer to reformat raw hex.
function formatMacAddress(hex) {
  if (!hex || typeof hex !== "string" || hex.length !== 12 || !/^[0-9a-f]{12}$/i.test(hex)) return null;
  return hex.toLowerCase().match(/.{2}/g).join(":");
}

function buildInterfaceIdentity(discovered) {
  return {
    name: discovered.displayName || discovered.ifName || discovered.ifDescr || `Interface ${discovered.ifIndex}`,
    description: discovered.ifAlias || discovered.ifDescr || "",
    ifIndex: discovered.ifIndex,
    adminState: adminStateFromStatus(discovered.ifAdminStatus),
    adminStatus: discovered.ifAdminStatus ?? null,
    speedMbps: discovered.ifSpeedMbps ?? null,
    speedSource: Number(discovered.highSpeed) > 0 ? "ifHighSpeed" : "ifSpeed",
    duplex: discovered.duplex || "UNKNOWN",
    mtu: Number.isFinite(Number(discovered.ifMtu)) && discovered.ifMtu > 0 ? Number(discovered.ifMtu) : null,
    macAddress: formatMacAddress(discovered.ifPhysAddress)
  };
}

// Upserts discovered interface identity/admin data into the device's
// interfaces, keyed by ifIndex - never a full delete-and-recreate of the
// array, so re-running discovery can't wipe out a manual `monitored`
// override or the operational/health state the fast poll maintains.
//
// Existing entries: only identity/admin fields (name, description,
// adminState, cached speed/duplex, lastAdminSyncAt) are refreshed.
// `monitored`, `status`, `lastCheckedAt` and `metrics` (operational
// snapshot + counters) are left exactly as they are - that's the fast
// poll's domain, not discovery's.
//
// New entries: `monitored` defaults to true only if the interface was
// admin-up at the moment it was first discovered; an unused/never-
// configured port defaults to false and stays quiet until an operator
// opts it in.
export function upsertDiscoveredInterfaces(existingInterfaces, discoveredItems) {
  const byIfIndex = new Map(
    dedupeByIfIndex(existingInterfaces || [])
      .filter(item => Number.isInteger(Number(item.ifIndex)))
      .map(item => [Number(item.ifIndex), item])
  );

  const now = new Date();

  for (const discovered of discoveredItems || []) {
    if (!Number.isInteger(discovered.ifIndex) || discovered.ifIndex <= 0) continue;
    const identity = buildInterfaceIdentity(discovered);
    const existing = byIfIndex.get(discovered.ifIndex);

    if (existing) {
      const plain = existing.toObject ? existing.toObject() : existing;
      byIfIndex.set(discovered.ifIndex, {
        ...plain,
        name: identity.name,
        description: identity.description,
        ifIndex: identity.ifIndex,
        adminState: identity.adminState,
        lastAdminSyncAt: now,
        metrics: {
          ...(plain.metrics || {}),
          adminStatus: identity.adminStatus,
          speedMbps: identity.speedMbps ?? plain.metrics?.speedMbps ?? null,
          speedSource: identity.speedMbps != null ? identity.speedSource : plain.metrics?.speedSource,
          duplex: identity.duplex !== "UNKNOWN" ? identity.duplex : (plain.metrics?.duplex || "UNKNOWN"),
          mtu: identity.mtu ?? plain.metrics?.mtu ?? null,
          macAddress: identity.macAddress ?? plain.metrics?.macAddress ?? null
        }
      });
    } else {
      byIfIndex.set(discovered.ifIndex, {
        name: identity.name,
        description: identity.description,
        ifIndex: identity.ifIndex,
        adminState: identity.adminState,
        monitored: identity.adminState === "UP",
        lastAdminSyncAt: now,
        status: "UNKNOWN",
        lastCheckedAt: null,
        metrics: {
          adminStatus: identity.adminStatus,
          speedMbps: identity.speedMbps,
          speedSource: identity.speedSource,
          duplex: identity.duplex,
          mtu: identity.mtu,
          macAddress: identity.macAddress
        }
      });
    }
  }

  return [...byIfIndex.values()].sort((a, b) => Number(a.ifIndex) - Number(b.ifIndex));
}

// Slow-cadence sync: refreshes admin status, names/descriptions and speed/
// duplex for every interface on the device via one discovery walk, then
// upserts the result. Bootstraps a device's interface list on first run
// (called automatically by the fast poll below if none exist yet).
export async function syncDeviceInterfacesAdmin(deviceId) {
  const device = await Device.findOne({ deviceId });
  if (!device) throw new Error("Device not found.");
  if (!device.snmp?.enabled) return { success: true, skipped: true, reason: "SNMP monitoring is disabled.", device };

  const discovered = await discoverInterfaces(device);
  device.interfaces = upsertDiscoveredInterfaces(device.interfaces, discovered);
  await device.save();
  if (global.io) emitToRealm(device.realmId, "device_updated", device.toObject());
  console.log(`[INTERFACE ADMIN SYNC] ${device.hostname}: ${discovered.length} interface(s) synced.`);
  return { success: true, skipped: false, device, count: discovered.length };
}

async function saveSample(device, iface) {
  const metrics = iface.metrics || {};
  const sampledAt = metrics.checkedAt || new Date();
  const expiresAt = new Date(new Date(sampledAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  await InterfaceSample.create({
    deviceId: device.deviceId,
    realmId: device.realmId,
    hostname: device.hostname,
    ifIndex: Number(iface.ifIndex),
    interfaceName: iface.name,
    status: iface.status,
    speedMbps: metrics.speedMbps,
    inBps: metrics.inBps,
    outBps: metrics.outBps,
    utilizationPercent: metrics.utilizationPercent,
    inErrors: metrics.inErrors || 0,
    outErrors: metrics.outErrors || 0,
    inDiscards: metrics.inDiscards || 0,
    outDiscards: metrics.outDiscards || 0,
    errorRatePerMin: metrics.errorRatePerMin,
    discardRatePerMin: metrics.discardRatePerMin,
    duplex: metrics.duplex || "UNKNOWN",
    health: metrics.health || "UNKNOWN",
    healthScore: metrics.healthScore,
    sampledAt,
    expiresAt
  });
}

function fallbackInterfaceState(device, item, now, reason) {
  const fallbackStatus = device.status === "DOWN" ? "DOWN" : "UNKNOWN";
  const previousMetrics = item.metrics || {};
  return {
    ...(item.toObject ? item.toObject() : item),
    ifIndex: Number(item.ifIndex),
    status: fallbackStatus,
    lastCheckedAt: now,
    metrics: {
      ...previousMetrics,
      ifIndex: Number(item.ifIndex),
      inBps: null,
      outBps: null,
      utilizationPercent: null,
      errorRatePerMin: null,
      discardRatePerMin: null,
      checkedAt: now,
      health: fallbackStatus === "DOWN" ? "DOWN" : "UNKNOWN",
      healthScore: fallbackStatus === "DOWN" ? 0 : null,
      healthReasons: [reason],
      // A poll failure proves nothing about recovery - every incident latch
      // (status and degradation) is preserved exactly as it was, not reset.
      activeIncidentId: previousMetrics.activeIncidentId || null,
      incidentLatched: previousMetrics.incidentLatched === true,
      degradationIncidentId: previousMetrics.degradationIncidentId || null,
      degradationIncidentLatched: previousMetrics.degradationIncidentLatched === true
    }
  };
}

// Fast-cadence poll: one bulk SNMP round trip per device
// (bulkGetInterfaceOperationalTable) covers every interface's operational
// status and counters, then per-interface math/health/incident logic runs
// in-memory - no SNMP call per interface. Admin status and monitored are
// read from the cached values the slow sync last wrote; they are not
// re-fetched here.
export async function pollDeviceInterfaces(deviceId) {
  const device = await Device.findOne({ deviceId });
  if (!device) throw new Error("Device not found.");
  if (!device.snmp?.enabled) return { success: true, skipped: true, reason: "SNMP monitoring is disabled.", device };

  // A concurrent poll (e.g. overlapping server restarts) can leave duplicate
  // entries for the same ifIndex; collapse them before processing so the
  // duplication can't perpetuate itself across polls.
  device.interfaces = dedupeByIfIndex(Array.isArray(device.interfaces) ? device.interfaces : []);

  if (!device.interfaces.length) {
    // Bootstrap: no interfaces known yet, so there is nothing cached to poll
    // operationally. Run one admin sync now to seed identity/admin state,
    // then fall through into the same cycle's operational poll below
    // (using the freshly-synced device) instead of waiting a full interval
    // for the first real status/traffic data.
    const syncResult = await syncDeviceInterfacesAdmin(deviceId);
    if (syncResult.skipped || !syncResult.device?.interfaces?.length) return syncResult;
    // syncResult.device is a separate Mongoose document instance; plain-ify
    // its interfaces before assigning onto this function's `device` so the
    // subdocuments are freshly cast against the right parent, not carrying
    // over internal references to the other document.
    device.interfaces = syncResult.device.interfaces.map(item => (item.toObject ? item.toObject() : item));
  }

  const now = new Date();
  let operationalTable;

  try {
    operationalTable = await bulkGetInterfaceOperationalTable(device);
  } catch (error) {
    console.error(`[INTERFACE MONITOR] Bulk poll failed for ${device.hostname}: ${error.message}`);
    const updatedInterfaces = [];
    for (const item of device.interfaces) {
      const fallback = fallbackInterfaceState(device, item, now, device.status === "DOWN" ? "Parent device is DOWN; interface state cannot be independently polled." : `SNMP interface poll failed: ${error.message}`);
      updatedInterfaces.push(fallback);
      try { await saveSample(device, fallback); } catch (sampleError) { console.error(`[INTERFACE MONITOR] Failed to save fallback sample for ${device.hostname} ${item.name}: ${sampleError.message}`); }
    }
    device.interfaces = updatedInterfaces;
    await device.save();
    if (global.io) emitToRealm(device.realmId, "device_updated", device.toObject());
    return { success: true, skipped: false, device, error: error.message };
  }

  const updatedInterfaces = [];

  for (const item of device.interfaces) {
    if (!item.ifIndex) {
      updatedInterfaces.push(item);
      continue;
    }

    const ifIndex = Number(item.ifIndex);
    const row = operationalTable.get(ifIndex);

    if (!row) {
      const fallback = fallbackInterfaceState(device, item, now, "Interface was not present in this poll's SNMP response.");
      updatedInterfaces.push(fallback);
      try { await saveSample(device, fallback); } catch (sampleError) { console.error(`[INTERFACE MONITOR] Failed to save fallback sample for ${device.hostname} ${item.name}: ${sampleError.message}`); }
      continue;
    }

    const previousMetrics = item.metrics || null;
    const previousCheckedAt = previousMetrics?.checkedAt ? new Date(previousMetrics.checkedAt) : null;
    // A counter-source flip (HC <-> legacy, e.g. a one-off SNMP hiccup on
    // the HC OIDs) isn't a real traffic delta - drop the baseline for this
    // cycle only so it can't produce a bogus rate spike; it re-establishes
    // on the next poll.
    const octetSourceChanged = Boolean(previousMetrics?.octetSource) && previousMetrics.octetSource !== row.octetSource;
    const elapsedSeconds = previousCheckedAt && !octetSourceChanged ? (now.getTime() - previousCheckedAt.getTime()) / 1000 : null;
    const inOctets = toNumber(row.inOctets) ?? 0;
    const outOctets = toNumber(row.outOctets) ?? 0;
    const inBps = calculateRate(inOctets, toNumber(previousMetrics?.inOctets), elapsedSeconds);
    const outBps = calculateRate(outOctets, toNumber(previousMetrics?.outOctets), elapsedSeconds);
    // speedMbps/duplex are not part of this fast bulk walk - they come from
    // the last admin sync, cached on the interface's metrics snapshot.
    const speedMbps = previousMetrics?.speedMbps ?? null;
    const utilizationPercent = calculateUtilization(inBps, outBps, speedMbps);
    const operState = row.operStatus === 1 ? "UP" : row.operStatus === 2 ? "DOWN" : "UNKNOWN";
    const adminState = item.adminState || "UNKNOWN";
    const monitored = item.monitored !== false;

    const inErrors = toNumber(row.inErrors) ?? 0;
    const outErrors = toNumber(row.outErrors) ?? 0;
    const inDiscards = toNumber(row.inDiscards) ?? 0;
    const outDiscards = toNumber(row.outDiscards) ?? 0;
    const errorsDelta = calculateCounterDelta(inErrors + outErrors, sumOrNull(previousMetrics?.inErrors, previousMetrics?.outErrors));
    const discardsDelta = calculateCounterDelta(inDiscards + outDiscards, sumOrNull(previousMetrics?.inDiscards, previousMetrics?.outDiscards));
    const errorRatePerMin = ratePerMinute(errorsDelta, elapsedSeconds);
    const discardRatePerMin = ratePerMinute(discardsDelta, elapsedSeconds);

    const baseMetrics = {
      ifIndex,
      speedMbps,
      speedSource: previousMetrics?.speedSource || null,
      duplex: previousMetrics?.duplex || "UNKNOWN",
      mtu: previousMetrics?.mtu ?? null,
      macAddress: previousMetrics?.macAddress ?? null,
      adminStatus: previousMetrics?.adminStatus ?? null,
      operStatus: row.operStatus,
      inOctets,
      outOctets,
      octetSource: row.octetSource,
      inErrors,
      outErrors,
      inDiscards,
      outDiscards,
      errorRatePerMin,
      discardRatePerMin,
      inBps,
      outBps,
      utilizationPercent,
      sampleIntervalSeconds: elapsedSeconds != null && elapsedSeconds > 0 ? elapsedSeconds : null,
      checkedAt: now
    };

    // Flap detection: a rolling window of recent up/down transitions.
    // Computed before health/incident sync so status incidents can be
    // suppressed for the remainder of this cycle once flapping is
    // detected/still cooling down.
    const previousOperState = item.status;
    const flapWindowMinutes = numberOr(device.alertThresholds?.flapWindowMinutes, FLAP_DEFAULTS.windowMinutes);
    const flapCooldownMinutes = numberOr(device.alertThresholds?.flapCooldownMinutes, FLAP_DEFAULTS.cooldownMinutes);
    const transitions = updateFlapWindow(item.flap?.transitions, previousOperState, operState, now, flapWindowMinutes);
    const flapResult = evaluateInterfaceFlap(transitions, device.alertThresholds);

    const previousCooldownUntil = item.flap?.cooldownUntil ? new Date(item.flap.cooldownUntil) : null;
    const cooldownStillActive = Boolean(previousCooldownUntil) && previousCooldownUntil.getTime() > now.getTime();
    // Suppression persists for the cooldown period even after the
    // transition count drops back under the threshold - "stops for a
    // cooldown period" rather than resuming per-transition incidents the
    // instant the pattern happens to pause.
    const cooldownUntil = flapResult.isFlapping
      ? new Date(now.getTime() + flapCooldownMinutes * 60000)
      : (cooldownStillActive ? previousCooldownUntil : null);
    const suppressedByFlap = Boolean(cooldownUntil);

    const healthResult = evaluateInterfaceHealth(baseMetrics, operState, device.alertThresholds, { adminState, monitored });
    const eligibleForFaultEvaluation = ["HEALTHY", "WARNING", "DEGRADED", "CRITICAL"].includes(healthResult.health);

    const previousIncidentId = previousMetrics?.activeIncidentId || null;
    const previousLatched = previousMetrics?.incidentLatched === true;
    const previousDegradationIncidentId = previousMetrics?.degradationIncidentId || null;
    const previousDegradationLatched = previousMetrics?.degradationIncidentLatched === true;

    const tempInterface = {
      ...(item.toObject ? item.toObject() : item),
      name: item.name,
      ifIndex,
      status: operState,
      metrics: {
        ...baseMetrics,
        ...healthResult,
        activeIncidentId: previousIncidentId,
        incidentLatched: previousLatched,
        degradationIncidentId: previousDegradationIncidentId,
        degradationIncidentLatched: previousDegradationLatched
      },
      flap: {
        transitions,
        incidentId: item.flap?.incidentId || null,
        incidentLatched: item.flap?.incidentLatched === true,
        cooldownUntil
      }
    };

    // Error/discard RATE is its own fault axis, independent of utilization/
    // status - only evaluated when the interface is actually eligible
    // (admin-up, monitored, oper-up) and not currently flap-suppressed
    // (a bouncing link's counters are noise, not a meaningful rate). When
    // not eligible, treat it as recovered so any previously-open
    // degradation incident resolves through the normal path rather than
    // being silently orphaned.
    const errorRateResult = (eligibleForFaultEvaluation && !suppressedByFlap)
      ? evaluateInterfaceErrorRate({ errorRatePerMin, discardRatePerMin }, device.alertThresholds)
      : { state: "HEALTHY", severity: "low", reasons: [] };

    let degradationIncidentId = previousDegradationIncidentId;
    let degradationIncidentLatched = previousDegradationLatched;
    try {
      const degradationResult = await syncInterfaceDegradationIncident({ device, iface: tempInterface, errorRateResult });
      degradationIncidentId = degradationResult?.incidentId || null;
      degradationIncidentLatched = degradationResult?.latch === true;
    } catch (degradationError) {
      degradationIncidentId = previousDegradationIncidentId;
      degradationIncidentLatched = previousDegradationLatched;
      console.error(`[INTERFACE DEGRADATION] ${device.hostname} ${item.name}: ${degradationError.message}`);
    }

    let activeIncidentId = previousIncidentId;
    let incidentLatched = previousLatched;

    if (!suppressedByFlap) {
      try {
        const incidentResult = await syncInterfaceIncident({ device, iface: tempInterface, healthResult });
        activeIncidentId = incidentResult?.incidentId || null;
        incidentLatched = incidentResult?.latch === true;
      } catch (incidentError) {
        activeIncidentId = previousIncidentId;
        incidentLatched = previousLatched;
        console.error(`[INTERFACE HEALTH] ${device.hostname} ${item.name}: ${incidentError.message}`);
      }
    } else {
      // While suppressed, the interface's disruption is represented solely
      // by the flap incident below - no parallel individually-tracked
      // status incident. Any incident open going into suppression gets
      // folded into the flap incident by syncInterfaceFlapIncident.
      activeIncidentId = null;
      incidentLatched = false;
    }

    let flapIncidentId = item.flap?.incidentId || null;
    let flapIncidentLatched = item.flap?.incidentLatched === true;
    try {
      const flapSyncResult = await syncInterfaceFlapIncident({ device, iface: tempInterface, flapResult, statusIncidentIdToFold: previousIncidentId });
      flapIncidentId = flapSyncResult?.incidentId || null;
      flapIncidentLatched = flapSyncResult?.latch === true;
    } catch (flapError) {
      console.error(`[INTERFACE FLAP] ${device.hostname} ${item.name}: ${flapError.message}`);
    }

    const updatedMetrics = {
      ...baseMetrics,
      health: healthResult.health,
      healthScore: healthResult.score,
      healthReasons: healthResult.reasons,
      activeIncidentId,
      incidentLatched,
      degradationIncidentId,
      degradationIncidentLatched
    };

    const updatedInterface = {
      ...(item.toObject ? item.toObject() : item),
      ifIndex,
      status: operState,
      metrics: updatedMetrics,
      flap: {
        transitions,
        incidentId: flapIncidentId,
        incidentLatched: flapIncidentLatched,
        cooldownUntil
      },
      lastCheckedAt: now
    };

    updatedInterfaces.push(updatedInterface);
    try { await saveSample(device, updatedInterface); } catch (sampleError) { console.error(`[INTERFACE MONITOR] Failed to save sample for ${device.hostname} ${item.name}: ${sampleError.message}`); }
  }

  device.interfaces = updatedInterfaces;
  await device.save();
  if (global.io) emitToRealm(device.realmId, "device_updated", device.toObject());
  return { success: true, skipped: false, device };
}

async function saveSystemSample(device, metric, utilizationPercent, health, sampledAt) {
  const expiresAt = new Date(sampledAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  await DeviceSystemSample.create({
    deviceId: device.deviceId,
    realmId: device.realmId,
    hostname: device.hostname,
    metric,
    utilizationPercent,
    health,
    sampledAt,
    expiresAt
  });
}

// Device-level CPU/memory poll: same threshold/incident pattern as
// interface utilization (evaluate -> sync incident -> persist snapshot +
// history sample), just scoped to the whole device rather than an
// interface. Runs on the same fast cadence as interface polling - CPU/
// memory spikes are as transient and worth catching promptly as a traffic
// spike, unlike admin status/identity which changes rarely.
export async function pollDeviceSystemHealth(deviceId) {
  const device = await Device.findOne({ deviceId });
  if (!device) throw new Error("Device not found.");
  if (!device.snmp?.enabled) return { success: true, skipped: true, reason: "SNMP monitoring is disabled.", device };

  let metrics;
  try {
    metrics = await getDeviceSystemMetrics(device);
  } catch (error) {
    console.error(`[SYSTEM HEALTH] Poll failed for ${device.hostname}: ${error.message}`);
    return { success: true, skipped: true, reason: error.message, device };
  }

  const now = new Date();
  const thresholds = device.alertThresholds || {};

  const cpuHealthResult = evaluateSystemMetricHealth(metrics.cpuPercent, { warning: thresholds.cpuWarning, critical: thresholds.cpuCritical }, "CPU utilization");
  const previousCpu = device.systemHealth?.cpu || {};
  let cpuIncidentId = previousCpu.activeIncidentId || null;
  let cpuIncidentLatched = previousCpu.incidentLatched === true;
  try {
    const cpuResult = await syncSystemHealthIncident({ device, metricKind: "CPU", healthResult: cpuHealthResult, currentIncidentId: cpuIncidentId, currentLatched: cpuIncidentLatched });
    cpuIncidentId = cpuResult?.incidentId || null;
    cpuIncidentLatched = cpuResult?.latch === true;
  } catch (error) {
    console.error(`[SYSTEM HEALTH] CPU incident sync failed for ${device.hostname}: ${error.message}`);
  }
  device.systemHealth.cpu = { utilizationPercent: metrics.cpuPercent, checkedAt: now, health: cpuHealthResult.health, healthReasons: cpuHealthResult.reasons, activeIncidentId: cpuIncidentId, incidentLatched: cpuIncidentLatched };
  if (metrics.cpuPercent != null) {
    try { await saveSystemSample(device, "cpu", metrics.cpuPercent, cpuHealthResult.health, now); } catch (error) { console.error(`[SYSTEM HEALTH] Failed to save CPU sample for ${device.hostname}: ${error.message}`); }
  }

  const memoryHealthResult = evaluateSystemMetricHealth(metrics.memoryUtilizationPercent, { warning: thresholds.memoryWarning, critical: thresholds.memoryCritical }, "Memory utilization");
  const previousMemory = device.systemHealth?.memory || {};
  let memoryIncidentId = previousMemory.activeIncidentId || null;
  let memoryIncidentLatched = previousMemory.incidentLatched === true;
  try {
    const memoryResult = await syncSystemHealthIncident({ device, metricKind: "MEMORY", healthResult: memoryHealthResult, currentIncidentId: memoryIncidentId, currentLatched: memoryIncidentLatched });
    memoryIncidentId = memoryResult?.incidentId || null;
    memoryIncidentLatched = memoryResult?.latch === true;
  } catch (error) {
    console.error(`[SYSTEM HEALTH] Memory incident sync failed for ${device.hostname}: ${error.message}`);
  }
  device.systemHealth.memory = { utilizationPercent: metrics.memoryUtilizationPercent, checkedAt: now, health: memoryHealthResult.health, healthReasons: memoryHealthResult.reasons, activeIncidentId: memoryIncidentId, incidentLatched: memoryIncidentLatched };
  if (metrics.memoryUtilizationPercent != null) {
    try { await saveSystemSample(device, "memory", metrics.memoryUtilizationPercent, memoryHealthResult.health, now); } catch (error) { console.error(`[SYSTEM HEALTH] Failed to save memory sample for ${device.hostname}: ${error.message}`); }
  }

  await device.save();
  if (global.io) emitToRealm(device.realmId, "device_updated", device.toObject());
  return { success: true, device };
}

export function stopInterfaceMonitoring(deviceId) {
  const timers = monitoringTimers.get(deviceId);
  if (!timers) return;
  clearInterval(timers.fast);
  clearInterval(timers.slow);
  monitoringTimers.delete(deviceId);
}

export async function startInterfaceMonitoring(device) {
  stopInterfaceMonitoring(device.deviceId);
  if (!device.monitoringEnabled || !device.snmp?.enabled) return;

  const fastInterval = Math.max(5, Number(device.pollingInterval || 30));

  // Always sync admin state before the first operational poll, even for a
  // device that already has interfaces on record (e.g. from before the
  // adminState/monitored fields existed, or simply stale after a server
  // restart) - otherwise the fast poll's admin gating would evaluate
  // against a never-synced "UNKNOWN" adminState for up to the full slow
  // sync interval. evaluateInterfaceHealth treats UNKNOWN as "fall through
  // to normal evaluation" rather than suppressing, so this isn't a
  // correctness requirement any more, but it closes the staleness window
  // immediately instead of leaving admin state (and monitored defaults for
  // any newly-appeared interface) wrong for up to ten minutes.
  if (device.interfaces?.length) {
    try { await syncDeviceInterfacesAdmin(device.deviceId); }
    catch (error) { console.error(`[INTERFACE ADMIN SYNC] Initial sync failed for ${device.hostname}: ${error.message}`); }
  }

  // SNMP walks against an unreachable device can legitimately take up to
  // ~18s each (timeout:5000 x up to 3 retries with backoff:1.2 - see
  // snmpService.js's createCommonOptions), and a poll cycle can issue
  // several of those sequentially. That can exceed fastInterval (as low as
  // 5s), so setInterval alone would stack up overlapping in-flight polls -
  // each with its own SNMP session/timers/buffers - without bound for any
  // device that stays down. This flag skips a tick entirely while the
  // previous one is still running, so at most one poll per device is ever
  // in flight.
  let fastCycleRunning = false;
  const fastCycle = async () => {
    if (fastCycleRunning) return;
    fastCycleRunning = true;
    try {
      try { await pollDeviceInterfaces(device.deviceId); }
      catch (error) { console.error(`[INTERFACE MONITOR] Poll failed for ${device.hostname}: ${error.message}`); }
      try { await pollDeviceSystemHealth(device.deviceId); }
      catch (error) { console.error(`[SYSTEM HEALTH] Poll failed for ${device.hostname}: ${error.message}`); }
    } finally {
      fastCycleRunning = false;
    }
  };

  await fastCycle();

  const fastTimer = setInterval(fastCycle, fastInterval * 1000);

  let slowSyncRunning = false;
  const slowTimer = setInterval(async () => {
    if (slowSyncRunning) return;
    slowSyncRunning = true;
    try { await syncDeviceInterfacesAdmin(device.deviceId); }
    catch (error) { console.error(`[INTERFACE ADMIN SYNC] Sync failed for ${device.hostname}: ${error.message}`); }
    finally { slowSyncRunning = false; }
  }, ADMIN_SYNC_INTERVAL_SECONDS * 1000);

  monitoringTimers.set(device.deviceId, { fast: fastTimer, slow: slowTimer });
  console.log(`[INTERFACE MONITOR] ${device.hostname}: operational poll every ${fastInterval}s, admin sync every ${ADMIN_SYNC_INTERVAL_SECONDS}s`);
}

export function stopAllInterfaceMonitoring() {
  for (const deviceId of monitoringTimers.keys()) stopInterfaceMonitoring(deviceId);
}

export async function startAllInterfaceMonitoring() {
  const devices = await Device.find({ monitoringEnabled: true, "snmp.enabled": true });
  for (const device of devices) await startInterfaceMonitoring(device);
  console.log(`[INTERFACE MONITOR] Started for ${devices.length} SNMP device(s).`);
  return devices.length;
}

export default { pollDeviceInterfaces, pollDeviceSystemHealth, syncDeviceInterfacesAdmin, upsertDiscoveredInterfaces, startInterfaceMonitoring, stopInterfaceMonitoring, startAllInterfaceMonitoring, stopAllInterfaceMonitoring };
