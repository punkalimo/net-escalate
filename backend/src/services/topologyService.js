import snmp from "net-snmp";
import Device from "../models/Device.js";
import { discoverInterfaces } from "./snmpService.js";

const OIDS = {
  cdp: "1.3.6.1.4.1.9.9.23.1.2.1.1",
  lldp: "1.0.8802.1.1.2.1.4.1.1"
};

function createSession(device) {
  const version = device.snmp?.version || "2c";
  const community = device.snmp?.community || "public";
  return snmp.createSession(device.ipAddress, community, {
    version: version === "1" ? snmp.Version1 : snmp.Version2c,
    timeout: 4500,
    retries: 1
  });
}

function safeClose(session) {
  try { session?.close?.(); } catch (error) {
    if (error?.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") console.warn(`[TOPOLOGY] SNMP cleanup: ${error.message}`);
  }
}

function walk(device, oid) {
  const session = createSession(device);
  return new Promise((resolve) => {
    const rows = [];
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      safeClose(session);
      resolve({ rows, error: error ? error.message : null });
    };
    try {
      session.subtree(oid, 25, varbinds => {
        for (const vb of varbinds || []) {
          if (!snmp.isVarbindError(vb)) rows.push({ oid: vb.oid, value: Buffer.isBuffer(vb.value) ? vb.value.toString("hex") : String(vb.value) });
        }
      }, error => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

function groupRows(rows, root, columns) {
  const grouped = new Map();
  for (const row of rows) {
    const parts = row.oid.split(".");
    const column = Number(parts[parts.length - 2]);
    const index = Number(parts[parts.length - 1]);
    if (!Number.isFinite(column) || !Number.isFinite(index)) continue;
    if (!grouped.has(index)) grouped.set(index, {});
    if (columns[column]) grouped.get(index)[columns[column]] = row.value;
  }
  return [...grouped.values()];
}

async function discoverCdp(device, interfaceMap) {
  const result = await walk(device, OIDS.cdp);
  if (result.error) return { neighbors: [], error: result.error };
  const rows = groupRows(result.rows, OIDS.cdp, {
    1: "localIfIndex", 2: "deviceIndex", 3: "addressType", 4: "address",
    5: "version", 6: "deviceId", 7: "remotePort", 8: "platform", 9: "capabilities",
    11: "nativeVlan"
  });
  return { neighbors: rows.filter(r => r.deviceId).map(r => ({
    protocol: "CDP",
    localIfIndex: Number(r.localIfIndex),
    localInterface: interfaceMap.get(Number(r.localIfIndex)) || `ifIndex ${r.localIfIndex}`,
    remoteDevice: r.deviceId,
    remoteInterface: r.remotePort || "",
    platform: r.platform || "",
    address: r.address || ""
  })), error: null };
}

async function discoverLldp(device, interfaceMap) {
  const result = await walk(device, OIDS.lldp);
  if (result.error) return { neighbors: [], error: result.error };
  const rows = groupRows(result.rows, OIDS.lldp, {
    4: "chassisSubtype", 5: "chassisId", 6: "portSubtype", 7: "remotePort",
    8: "remotePortDescription", 9: "remoteSystemName", 10: "remoteSystemDescription",
    11: "capabilities"
  });
  return { neighbors: rows.filter(r => r.remoteSystemName || r.chassisId).map(r => ({
    protocol: "LLDP",
    localIfIndex: null,
    localInterface: "",
    remoteDevice: r.remoteSystemName || r.chassisId,
    remoteInterface: r.remotePortDescription || r.remotePort || "",
    platform: r.remoteSystemDescription || "",
    address: ""
  })), error: null };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findDeviceByNeighbor(devices, neighbor) {
  const target = normalizeName(neighbor.remoteDevice);
  if (!target) return null;
  return devices.find(d => normalizeName(d.hostname) === target || normalizeName(d.deviceId) === target || normalizeName(d.ipAddress) === target || normalizeName(d.hostname).includes(target) || target.includes(normalizeName(d.hostname))) || null;
}

export async function discoverTopology() {
  const devices = await Device.find({}).lean().exec();
  const nodes = devices.map(device => ({
    id: device.deviceId,
    label: device.hostname,
    hostname: device.hostname,
    ipAddress: device.ipAddress,
    deviceType: device.deviceType,
    vendor: device.vendor,
    model: device.model,
    location: device.location,
    status: device.status,
    monitoringEnabled: device.monitoringEnabled
  }));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = [];
  const seen = new Set();
  const diagnostics = [];

  for (const device of devices) {
    if (!device.snmp?.enabled) {
      diagnostics.push({ deviceId: device.deviceId, hostname: device.hostname, status: "SKIPPED", reason: "SNMP disabled" });
      continue;
    }
    try {
      const discovered = await discoverInterfaces(device);
      const interfaceMap = new Map((discovered || []).map(i => [Number(i.ifIndex), i.ifDescr || `ifIndex ${i.ifIndex}`]));
      const [cdp, lldp] = await Promise.all([discoverCdp(device, interfaceMap), discoverLldp(device, interfaceMap)]);
      const neighbors = [...cdp.neighbors, ...lldp.neighbors];
      diagnostics.push({ deviceId: device.deviceId, hostname: device.hostname, status: "OK", cdp: cdp.neighbors.length, lldp: lldp.neighbors.length, errors: [cdp.error, lldp.error].filter(Boolean) });

      for (const neighbor of neighbors) {
        const target = findDeviceByNeighbor(devices, neighbor);
        if (!target || target.deviceId === device.deviceId || !nodeIds.has(target.deviceId)) continue;
        const key = [device.deviceId, target.deviceId].sort().join("::") + `::${neighbor.localInterface}::${neighbor.remoteInterface}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          id: `EDGE-${edges.length + 1}`,
          source: device.deviceId,
          target: target.deviceId,
          sourceInterface: neighbor.localInterface || "",
          targetInterface: neighbor.remoteInterface || "",
          protocol: neighbor.protocol,
          state: device.status === "DOWN" || target.status === "DOWN" ? "DOWN" : device.status === "DEGRADED" || target.status === "DEGRADED" ? "DEGRADED" : "UP",
          platform: neighbor.platform || "",
          address: neighbor.address || ""
        });
      }
    } catch (error) {
      diagnostics.push({ deviceId: device.deviceId, hostname: device.hostname, status: "ERROR", reason: error.message });
    }
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    discovery: { nodes: nodes.length, links: edges.length },
    nodes,
    edges,
    diagnostics
  };
}

export default { discoverTopology };
