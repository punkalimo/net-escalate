import snmp from "net-snmp";
import Device from "../models/Device.js";
import { discoverInterfaces } from "./snmpService.js";

const OIDS = { cdp: "1.3.6.1.4.1.9.9.23.1.2.1.1", lldp: "1.0.8802.1.1.2.1.4.1.1" };

function createSession(device) {
  const version = device.snmp?.version || "2c";
  const community = device.snmp?.community || "public";
  return snmp.createSession(device.ipAddress, community, { version: version === "1" ? snmp.Version1 : snmp.Version2c, timeout: 4500, retries: 1 });
}
function safeClose(session) { try { session?.close?.(); } catch (error) { if (error?.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") console.warn(`[TOPOLOGY] SNMP cleanup: ${error.message}`); } }
function walk(device, oid) {
  const session = createSession(device);
  return new Promise(resolve => {
    const rows = []; let settled = false;
    const finish = (error = null) => { if (settled) return; settled = true; safeClose(session); resolve({ rows, error: error ? error.message : null }); };
    try { session.subtree(oid, 25, varbinds => { for (const vb of varbinds || []) if (!snmp.isVarbindError(vb)) rows.push({ oid: vb.oid, value: Buffer.isBuffer(vb.value) ? vb.value.toString("hex") : String(vb.value) }); }, error => finish(error)); } catch (error) { finish(error); }
  });
}

function parseCdpRows(rows) {
  const grouped = new Map();
  const fields = { 1: "localIfIndex", 2: "deviceIndex", 3: "addressType", 4: "address", 5: "version", 6: "deviceId", 7: "remotePort", 8: "platform", 9: "capabilities", 11: "nativeVlan" };
  for (const row of rows) {
    const parts = row.oid.split(".");
    const column = Number(parts.at(-3)), localIfIndex = Number(parts.at(-2)), deviceIndex = Number(parts.at(-1));
    if (!Number.isFinite(column) || !Number.isFinite(localIfIndex) || !Number.isFinite(deviceIndex)) continue;
    const key = `${localIfIndex}:${deviceIndex}`;
    if (!grouped.has(key)) grouped.set(key, { localIfIndex, deviceIndex });
    if (fields[column]) grouped.get(key)[fields[column]] = row.value;
  }
  return [...grouped.values()];
}

function parseLldpRows(rows) {
  const grouped = new Map();
  const fields = { 4: "chassisSubtype", 5: "chassisId", 6: "portSubtype", 7: "remotePort", 8: "remotePortDescription", 9: "remoteSystemName", 10: "remoteSystemDescription", 11: "capabilities" };
  for (const row of rows) {
    const parts = row.oid.split(".");
    const column = Number(parts.at(-3)), localPortNum = Number(parts.at(-2)), remoteIndex = Number(parts.at(-1));
    if (!Number.isFinite(column) || !Number.isFinite(localPortNum) || !Number.isFinite(remoteIndex)) continue;
    const key = `${localPortNum}:${remoteIndex}`;
    if (!grouped.has(key)) grouped.set(key, { localPortNum, remoteIndex });
    if (fields[column]) grouped.get(key)[fields[column]] = row.value;
  }
  return [...grouped.values()];
}

async function discoverCdp(device, interfaceMap) {
  const result = await walk(device, OIDS.cdp);
  if (result.error) return { neighbors: [], error: result.error };
  return { neighbors: parseCdpRows(result.rows).filter(r => r.deviceId).map(r => ({ protocol: "CDP", localIfIndex: Number(r.localIfIndex), localInterface: interfaceMap.get(Number(r.localIfIndex)) || `ifIndex ${r.localIfIndex}`, remoteDevice: r.deviceId, remoteInterface: r.remotePort || "", platform: r.platform || "", address: r.address || "" })), error: null };
}
async function discoverLldp(device, interfaceMap) {
  const result = await walk(device, OIDS.lldp);
  if (result.error) return { neighbors: [], error: result.error };
  return { neighbors: parseLldpRows(result.rows).filter(r => r.remoteSystemName || r.chassisId).map(r => ({ protocol: "LLDP", localIfIndex: r.localPortNum, localInterface: interfaceMap.get(Number(r.localPortNum)) || `port ${r.localPortNum}`, remoteDevice: r.remoteSystemName || r.chassisId, remoteInterface: r.remotePortDescription || r.remotePort || "", platform: r.remoteSystemDescription || "", address: "" })), error: null };
}
function normalizeName(value) { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function findDeviceByNeighbor(devices, neighbor) {
  const target = normalizeName(neighbor.remoteDevice); if (!target) return null;
  return devices.find(d => [d.hostname, d.deviceId, d.ipAddress].map(normalizeName).filter(Boolean).some(candidate => candidate === target || candidate.includes(target) || target.includes(candidate))) || null;
}

function edgeState(a, b) {
  return a.status === "DOWN" || b.status === "DOWN" ? "DOWN" : a.status === "DEGRADED" || b.status === "DEGRADED" ? "DEGRADED" : "UP";
}

export async function discoverTopology(realmId) {
  const devices = await Device.find({ realmId }).lean().exec();
  const nodes = devices.map(device => ({ id: device.deviceId, label: device.hostname, hostname: device.hostname, ipAddress: device.ipAddress, deviceType: device.deviceType, vendor: device.vendor, model: device.model, location: device.location, status: device.status, monitoringEnabled: device.monitoringEnabled }));
  const nodeIds = new Set(nodes.map(n => n.id)); const edges = []; const seen = new Set(); const pairsLinked = new Set(); const diagnostics = [];
  const deviceById = new Map(devices.map(d => [d.deviceId, d]));

  for (const device of devices) {
    if (!device.snmp?.enabled) { diagnostics.push({ deviceId: device.deviceId, hostname: device.hostname, status: "SKIPPED", reason: "SNMP disabled" }); continue; }
    try {
      const discovered = await discoverInterfaces(device);
      const interfaceMap = new Map((discovered || []).map(i => [Number(i.ifIndex), i.ifDescr || `ifIndex ${i.ifIndex}`]));
      const [cdp, lldp] = await Promise.all([discoverCdp(device, interfaceMap), discoverLldp(device, interfaceMap)]);
      const neighbors = [...cdp.neighbors, ...lldp.neighbors];
      diagnostics.push({ deviceId: device.deviceId, hostname: device.hostname, status: "OK", cdp: cdp.neighbors.length, lldp: lldp.neighbors.length, errors: [cdp.error, lldp.error].filter(Boolean) });
      for (const neighbor of neighbors) {
        const target = findDeviceByNeighbor(devices, neighbor);
        if (!target || target.deviceId === device.deviceId || !nodeIds.has(target.deviceId)) continue;
        const pairKey = [device.deviceId, target.deviceId].sort().join("::");
        const key = `${pairKey}::${neighbor.localInterface}::${neighbor.remoteInterface}`;
        if (seen.has(key)) continue; seen.add(key); pairsLinked.add(pairKey);
        edges.push({ id: `EDGE-${edges.length + 1}`, source: device.deviceId, target: target.deviceId, sourceInterface: neighbor.localInterface || "", targetInterface: neighbor.remoteInterface || "", protocol: neighbor.protocol, state: edgeState(device, target), platform: neighbor.platform || "", address: neighbor.address || "" });
      }
    } catch (error) { diagnostics.push({ deviceId: device.deviceId, hostname: device.hostname, status: "ERROR", reason: error.message }); }
  }

  // parentDeviceId (Device.js) is hierarchy metadata an operator can set by
  // hand regardless of whether SNMP/CDP/LLDP is available on that device -
  // e.g. no lab hardware, or a device type CDP/LLDP doesn't run on at all
  // (NetEscalate's own demo scenario relies on this - see
  // scripts/seed-demo-scenario.mjs). Only fills in a link for a device pair
  // that real CDP/LLDP discovery above found nothing for; never overrides
  // real evidence.
  for (const device of devices) {
    if (!device.parentDeviceId) continue;
    const parent = deviceById.get(device.parentDeviceId);
    if (!parent || parent.deviceId === device.deviceId) continue;
    const pairKey = [device.deviceId, parent.deviceId].sort().join("::");
    if (pairsLinked.has(pairKey)) continue;
    pairsLinked.add(pairKey);
    edges.push({ id: `EDGE-${edges.length + 1}`, source: parent.deviceId, target: device.deviceId, sourceInterface: "", targetInterface: "", protocol: "MANUAL", state: edgeState(parent, device), platform: "", address: "" });
  }

  return { success: true, generatedAt: new Date().toISOString(), discovery: { nodes: nodes.length, links: edges.length }, nodes, edges, diagnostics };
}
export default { discoverTopology };
