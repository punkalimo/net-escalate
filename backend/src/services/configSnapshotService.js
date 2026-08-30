// Fingerprints each device's configuration-relevant fields and stores a
// ConfigSnapshot when it differs from the last one - the "change tracking"
// half of Phase 9. Moved out of phase4Routes.js (which now imports
// captureSnapshot from here instead of defining it locally) so a periodic
// sweep can call the exact same logic a manual capture uses.
//
// Deliberately fingerprints only genuinely configuration-like fields
// (hostname/vendor/model, monitoring methods/ports, SNMP settings, and each
// interface's admin state/monitored flag/duplex/speed/mtu/description) and
// NOT live operational data (status, counters, health score, timestamps).
// The original version fingerprinted the entire interfaces array including
// per-poll traffic counters, which meant the fingerprint differed on almost
// every capture regardless of whether anything was actually reconfigured -
// useless as a "did the config change" signal and exactly the kind of noise
// changeCorrelationService.js must not present as evidence.

import crypto from "node:crypto";
import Device from "../models/Device.js";
import ConfigSnapshot from "../models/ConfigSnapshot.js";

export function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function configFields(device) {
  return {
    hostname: device.hostname,
    ipAddress: device.ipAddress,
    deviceType: device.deviceType,
    vendor: device.vendor,
    model: device.model,
    monitoringMethods: device.monitoringMethods,
    monitoredPorts: (device.monitoredPorts || []).map(port => ({ port: port.port, protocol: port.protocol, enabled: port.enabled })),
    snmp: { enabled: device.snmp?.enabled, version: device.snmp?.version },
    interfaces: (device.interfaces || []).map(iface => ({
      ifIndex: iface.ifIndex,
      name: iface.name,
      description: iface.description,
      adminState: iface.adminState,
      monitored: iface.monitored,
      duplex: iface.metrics?.duplex ?? null,
      speedMbps: iface.metrics?.speedMbps ?? null,
      mtu: iface.metrics?.mtu ?? null
    }))
  };
}

export async function captureSnapshot(device) {
  const config = configFields(device);
  const fp = fingerprint(config);
  const previous = await ConfigSnapshot.findOne({ deviceId: device.deviceId }).sort({ capturedAt: -1 }).lean();
  const changes = previous && previous.fingerprint !== fp ? ["Configuration fingerprint changed", "Compare the latest interface, monitoring and port inventory"] : [];
  return ConfigSnapshot.create({ deviceId: device.deviceId, hostname: device.hostname, fingerprint: fp, config, changed: Boolean(changes.length), changes });
}

export async function sweepConfigSnapshots() {
  const devices = await Device.find({ monitoringEnabled: true }).lean();
  let captured = 0;
  let changed = 0;

  for (const device of devices) {
    try {
      const snapshot = await captureSnapshot(device);
      captured += 1;
      if (snapshot.changed) changed += 1;
    } catch (error) {
      console.error(`[CONFIG SNAPSHOT SWEEP] Failed for ${device.hostname}: ${error.message}`);
    }
  }

  return { devices: devices.length, captured, changed };
}

let sweepTimer = null;

// Same overlap guard as escalationSweepService.js/severityService.js: each
// device snapshot is a real SNMP session (captureSnapshot), so a large
// enough fleet could in principle take longer than the interval to walk -
// skip a tick rather than starting a second pass on top of a still-running
// one.
let sweepRunning = false;

export function startConfigSnapshotSweep(intervalSeconds = 900) {
  stopConfigSnapshotSweep();
  sweepTimer = setInterval(() => {
    if (sweepRunning) return;
    sweepRunning = true;
    sweepConfigSnapshots()
      .catch(error => console.error(`[CONFIG SNAPSHOT SWEEP] Failed: ${error.message}`))
      .finally(() => { sweepRunning = false; });
  }, intervalSeconds * 1000);
  console.log(`[CONFIG SNAPSHOT SWEEP] Started, every ${intervalSeconds}s`);
}

export function stopConfigSnapshotSweep() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export default { captureSnapshot, sweepConfigSnapshots, startConfigSnapshotSweep, stopConfigSnapshotSweep, configFields, fingerprint };
