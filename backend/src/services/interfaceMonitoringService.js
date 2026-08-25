import Device from "../models/Device.js";
import InterfaceSample from "../models/InterfaceSample.js";
import { discoverInterfaces, getInterfaceMetrics } from "./snmpService.js";
import { evaluateInterfaceHealth, syncInterfaceIncident } from "./interfaceHealthService.js";

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

function mergeDiscoveredInterfaces(existing, discovered) {
  const existingByName = new Map(existing.map(item => [item.name, item]));
  return discovered.map(item => {
    const current = existingByName.get(item.ifDescr);
    return {
      ...(current?.toObject ? current.toObject() : current || {}),
      name: item.ifDescr || current?.name || `ifIndex-${item.ifIndex}`,
      description: current?.description || item.ifDescr || "",
      ifIndex: item.ifIndex,
      status: item.ifOperStatus === 1 ? "UP" : item.ifOperStatus === 2 ? "DOWN" : "UNKNOWN"
    };
  });
}

async function saveSample(device, iface) {
  const metrics = iface.metrics || {};
  const sampledAt = metrics.checkedAt || new Date();
  const expiresAt = new Date(new Date(sampledAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  await InterfaceSample.create({
    deviceId: device.deviceId,
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
    duplex: metrics.duplex || "UNKNOWN",
    health: metrics.health || "UNKNOWN",
    healthScore: metrics.healthScore,
    sampledAt,
    expiresAt
  });
}

export async function pollDeviceInterfaces(deviceId) {
  const device = await Device.findOne({ deviceId });
  if (!device) throw new Error("Device not found.");
  if (!device.snmp?.enabled) return { success: true, skipped: true, reason: "SNMP monitoring is disabled.", device };

  let interfaces = Array.isArray(device.interfaces) ? device.interfaces : [];
  const needsDiscovery = interfaces.length === 0 || interfaces.some(item => !item.ifIndex);
  if (needsDiscovery) {
    const discovered = await discoverInterfaces(device);
    interfaces = mergeDiscoveredInterfaces(interfaces, discovered);
    device.interfaces = interfaces;
  }

  const now = new Date();
  const updatedInterfaces = [];

  for (const item of device.interfaces) {
    if (!item.ifIndex) {
      updatedInterfaces.push(item);
      continue;
    }

    try {
      const metrics = await getInterfaceMetrics(device, Number(item.ifIndex));
      const previousMetrics = item.metrics || null;
      const previousCheckedAt = previousMetrics?.checkedAt ? new Date(previousMetrics.checkedAt) : null;
      const elapsedSeconds = previousCheckedAt ? (now.getTime() - previousCheckedAt.getTime()) / 1000 : null;
      const inOctets = toNumber(metrics.inOctets) ?? 0;
      const outOctets = toNumber(metrics.outOctets) ?? 0;
      const inBps = calculateRate(inOctets, toNumber(previousMetrics?.inOctets), elapsedSeconds);
      const outBps = calculateRate(outOctets, toNumber(previousMetrics?.outOctets), elapsedSeconds);
      const utilizationPercent = calculateUtilization(inBps, outBps, metrics.speedMbps);
      const status = metrics.operStatus === 1 ? "UP" : metrics.operStatus === 2 ? "DOWN" : "UNKNOWN";

      const baseMetrics = {
        ifIndex: metrics.ifIndex,
        speedMbps: metrics.speedMbps,
        speedSource: metrics.speedSource,
        duplex: metrics.duplex,
        inOctets,
        outOctets,
        inErrors: toNumber(metrics.inErrors) ?? 0,
        outErrors: toNumber(metrics.outErrors) ?? 0,
        inDiscards: toNumber(metrics.inDiscards) ?? 0,
        outDiscards: toNumber(metrics.outDiscards) ?? 0,
        inBps,
        outBps,
        utilizationPercent,
        sampleIntervalSeconds: elapsedSeconds != null && elapsedSeconds > 0 ? elapsedSeconds : null,
        checkedAt: now
      };

      const healthResult = evaluateInterfaceHealth(baseMetrics, status);
      const previousIncidentId = previousMetrics?.activeIncidentId || null;
      const previousLatched = previousMetrics?.incidentLatched === true;
      const tempInterface = {
        ...(item.toObject ? item.toObject() : item),
        name: item.name,
        ifIndex: Number(item.ifIndex),
        status,
        metrics: {
          ...baseMetrics,
          ...healthResult,
          activeIncidentId: previousIncidentId,
          incidentLatched: previousLatched
        }
      };

      let activeIncidentId = previousIncidentId;
      let incidentLatched = previousLatched;

      try {
        const incidentResult = await syncInterfaceIncident({ device, iface: tempInterface, healthResult });
        activeIncidentId = incidentResult?.incidentId || null;
        incidentLatched = incidentResult?.latch === true;
      } catch (incidentError) {
        activeIncidentId = previousIncidentId;
        incidentLatched = previousLatched;
        console.error(`[INTERFACE HEALTH] ${device.hostname} ${item.name}: ${incidentError.message}`);
      }

      const updatedMetrics = {
        ...baseMetrics,
        health: healthResult.health,
        healthScore: healthResult.score,
        healthReasons: healthResult.reasons,
        activeIncidentId,
        incidentLatched
      };

      const updatedInterface = {
        ...(item.toObject ? item.toObject() : item),
        ifIndex: Number(item.ifIndex),
        status,
        metrics: updatedMetrics,
        lastCheckedAt: now
      };

      updatedInterfaces.push(updatedInterface);
      await saveSample(device, updatedInterface);
    } catch (error) {
      // Never leave the previous HEALTHY/UP state visible after a failed poll.
      // If the parent device is already DOWN, the interface is effectively down
      // from the monitoring system's perspective; otherwise its state is UNKNOWN.
      const fallbackStatus = device.status === "DOWN" ? "DOWN" : "UNKNOWN";
      const previousMetrics = item.metrics || {};
      const fallbackMetrics = {
        ...previousMetrics,
        ifIndex: Number(item.ifIndex),
        inBps: null,
        outBps: null,
        utilizationPercent: null,
        checkedAt: now,
        health: fallbackStatus === "DOWN" ? "DOWN" : "UNKNOWN",
        healthScore: fallbackStatus === "DOWN" ? 0 : null,
        healthReasons: [
          fallbackStatus === "DOWN"
            ? "Parent device is DOWN; interface state cannot be independently polled."
            : `SNMP interface poll failed: ${error.message}`
        ],
        activeIncidentId: previousMetrics.activeIncidentId || null,
        incidentLatched: previousMetrics.incidentLatched === true
      };

      const fallbackInterface = {
        ...(item.toObject ? item.toObject() : item),
        ifIndex: Number(item.ifIndex),
        status: fallbackStatus,
        metrics: fallbackMetrics,
        lastCheckedAt: now
      };

      updatedInterfaces.push(fallbackInterface);
      try {
        await saveSample(device, fallbackInterface);
      } catch (sampleError) {
        console.error(`[INTERFACE MONITOR] Failed to save fallback sample for ${device.hostname} ${item.name}: ${sampleError.message}`);
      }
      console.error(`[INTERFACE MONITOR] ${device.hostname} ${item.name}: ${error.message}`);
    }
  }

  device.interfaces = updatedInterfaces;
  await device.save();
  if (global.io) global.io.emit("device_updated", device.toObject());
  return { success: true, skipped: false, device };
}

export function stopInterfaceMonitoring(deviceId) {
  const timer = monitoringTimers.get(deviceId);
  if (!timer) return;
  clearInterval(timer);
  monitoringTimers.delete(deviceId);
}

export async function startInterfaceMonitoring(device) {
  stopInterfaceMonitoring(device.deviceId);
  if (!device.monitoringEnabled || !device.snmp?.enabled) return;
  const interval = Math.max(5, Number(device.pollingInterval || 30));
  try { await pollDeviceInterfaces(device.deviceId); } catch (error) { console.error(`[INTERFACE MONITOR] Initial poll failed for ${device.hostname}: ${error.message}`); }
  const timer = setInterval(async () => {
    try { await pollDeviceInterfaces(device.deviceId); }
    catch (error) { console.error(`[INTERFACE MONITOR] Poll failed for ${device.hostname}: ${error.message}`); }
  }, interval * 1000);
  monitoringTimers.set(device.deviceId, timer);
  console.log(`[INTERFACE MONITOR] ${device.hostname} every ${interval}s`);
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

export default { pollDeviceInterfaces, startInterfaceMonitoring, stopInterfaceMonitoring, startAllInterfaceMonitoring, stopAllInterfaceMonitoring };
