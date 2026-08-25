import express from "express";
import crypto from "node:crypto";
import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import InterfaceSample from "../models/InterfaceSample.js";
import ConfigSnapshot from "../models/ConfigSnapshot.js";
import { correlateActiveIncidents } from "../services/incidentCorrelationService.js";
import { discoverTopology } from "../services/topologyService.js";
import { discoverInterfaces } from "../services/snmpService.js";

function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function classifyCause(incident, device) {
  const text = `${incident?.description || ""} ${device?.lastError || ""}`.toLowerCase();
  if (incident?.interfaceName || incident?.source === "INTERFACE_HEALTH") return { cause: "Interface degradation or outage", confidence: 92, evidence: ["Interface health signal", "Interface-level incident source"] };
  if (device?.status === "DOWN") return { cause: "Device reachability failure", confidence: 88, evidence: ["Device status is DOWN", "Active monitoring fault"] };
  if (text.includes("timeout") || text.includes("timed out")) return { cause: "Connectivity or latency failure", confidence: 82, evidence: ["Timeout detected", "Reachability probe failure"] };
  if (text.includes("error") || text.includes("discard")) return { cause: "Packet/error condition", confidence: 74, evidence: ["Error/discard signal in incident"] };
  return { cause: "Insufficient evidence", confidence: 45, evidence: ["No dominant failure signal detected"] };
}

async function captureSnapshot(device) {
  const config = { hostname: device.hostname, ipAddress: device.ipAddress, deviceType: device.deviceType, vendor: device.vendor, model: device.model, interfaces: device.interfaces, monitoringMethods: device.monitoringMethods, monitoredPorts: device.monitoredPorts, snmp: { enabled: device.snmp?.enabled, version: device.snmp?.version } };
  const fp = fingerprint(config);
  const previous = await ConfigSnapshot.findOne({ deviceId: device.deviceId }).sort({ capturedAt: -1 }).lean();
  const changes = previous && previous.fingerprint !== fp ? ["Configuration fingerprint changed", "Compare the latest interface, monitoring and port inventory"] : [];
  return ConfigSnapshot.create({ deviceId: device.deviceId, hostname: device.hostname, fingerprint: fp, config, changed: Boolean(changes.length), changes });
}

export default function phase4Routes(io) {
  const router = express.Router();
  router.get("/overview", async (req, res) => {
    try {
      const [devices, active, recent, samples] = await Promise.all([Device.find({}).lean(), Incident.countDocuments({ status: { $nin: ["RESOLVED"] } }), Incident.find({}).sort({ createdAt: -1 }).limit(50).lean(), InterfaceSample.find({}).sort({ sampledAt: -1 }).limit(500).lean()]);
      const utilization = samples.map(s => s.utilizationPercent).filter(v => Number.isFinite(v));
      return res.json({ success: true, generatedAt: new Date().toISOString(), kpis: { devices: devices.length, activeIncidents: active, downDevices: devices.filter(d => d.status === "DOWN").length, degradedDevices: devices.filter(d => d.status === "DEGRADED").length, avgUtilization: utilization.length ? utilization.reduce((a, b) => a + b, 0) / utilization.length : 0, peakUtilization: utilization.length ? Math.max(...utilization) : 0, interfaceErrors: samples.reduce((n, s) => n + (s.inErrors || 0) + (s.outErrors || 0) + (s.inDiscards || 0) + (s.outDiscards || 0), 0) }, devices: devices.map(d => ({ deviceId: d.deviceId, hostname: d.hostname, ipAddress: d.ipAddress, status: d.status, vendor: d.vendor, deviceType: d.deviceType, activeIncidentId: d.activeIncidentId })), recentIncidents: recent });
    } catch (error) { return res.status(500).json({ success: false, message: "Failed to load Phase 4 overview.", error: error.message }); }
  });

  router.get("/analytics", async (req, res) => {
    try {
      const hours = Math.min(Math.max(Number.parseInt(req.query.hours || "24", 10) || 24, 1), 168), since = new Date(Date.now() - hours * 3600 * 1000);
      const [incidents, samples] = await Promise.all([Incident.find({ createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean(), InterfaceSample.find({ sampledAt: { $gte: since } }).sort({ sampledAt: 1 }).lean()]);
      const buckets = new Map();
      for (const incident of incidents) { const key = new Date(incident.createdAt).toISOString().slice(0, 13) + ":00:00.000Z"; const bucket = buckets.get(key) || { time: key, incidents: 0, critical: 0, resolved: 0 }; bucket.incidents += 1; if (incident.severity === "critical") bucket.critical += 1; if (incident.status === "RESOLVED") bucket.resolved += 1; buckets.set(key, bucket); }
      const utilization = samples.map(s => Number(s.utilizationPercent)).filter(Number.isFinite);
      return res.json({ success: true, windowHours: hours, summary: { incidentCount: incidents.length, sampleCount: samples.length, averageUtilization: utilization.length ? utilization.reduce((a, b) => a + b, 0) / utilization.length : 0, peakUtilization: utilization.length ? Math.max(...utilization) : 0 }, timeline: [...buckets.values()] });
    } catch (error) { return res.status(500).json({ success: false, message: "Failed to load analytics.", error: error.message }); }
  });

  router.get("/rca", async (req, res) => {
    try {
      const incidents = await Incident.find({ status: { $ne: "RESOLVED" } }).sort({ createdAt: -1 }).limit(100).lean();
      const deviceMap = new Map((await Device.find({}).lean()).map(d => [d.hostname, d]));
      const analyses = incidents.map(incident => { const analysis = classifyCause(incident, deviceMap.get(incident.device)); return { incidentId: incident.incidentId, device: incident.device, severity: incident.severity, status: incident.status, ...analysis, nextAction: analysis.confidence >= 80 ? "Validate the indicated fault and inspect correlated child incidents." : "Collect interface, path and device evidence before escalating." }; });
      return res.json({ success: true, generatedAt: new Date().toISOString(), analyses });
    } catch (error) { return res.status(500).json({ success: false, message: "Failed to build RCA analysis.", error: error.message }); }
  });

  router.get("/config-changes", async (req, res) => {
    try {
      const snapshots = await ConfigSnapshot.find({}).sort({ capturedAt: -1 }).limit(200).lean(), latest = new Map(), changes = [];
      for (const snapshot of snapshots) { const previous = latest.get(snapshot.deviceId); if (previous && previous.fingerprint !== snapshot.fingerprint) changes.push({ deviceId: snapshot.deviceId, hostname: snapshot.hostname, capturedAt: snapshot.capturedAt, changes: snapshot.changes, previousFingerprint: previous.fingerprint, fingerprint: snapshot.fingerprint }); latest.set(snapshot.deviceId, snapshot); }
      return res.json({ success: true, changes });
    } catch (error) { return res.status(500).json({ success: false, message: "Failed to load configuration changes.", error: error.message }); }
  });

  router.post("/config-snapshots/:deviceId", async (req, res) => {
    try { const device = await Device.findOne({ deviceId: req.params.deviceId }); if (!device) return res.status(404).json({ success: false, message: "Device not found." }); return res.status(201).json({ success: true, snapshot: await captureSnapshot(device) }); }
    catch (error) { return res.status(500).json({ success: false, message: "Failed to capture configuration snapshot.", error: error.message }); }
  });

  router.post("/automation/run", async (req, res) => {
    const { action, deviceId } = req.body || {};
    try {
      if (action === "correlate") return res.json({ success: true, action, result: await correlateActiveIncidents({ forceTopology: false }) });
      if (action === "topology") return res.json({ success: true, action, result: await discoverTopology() });
      if (action === "snapshot" && deviceId) { const device = await Device.findOne({ deviceId }); if (!device) return res.status(404).json({ success: false, message: "Device not found." }); return res.json({ success: true, action, result: await captureSnapshot(device) }); }
      if (action === "interfaces" && deviceId) { const device = await Device.findOne({ deviceId }).lean(); if (!device) return res.status(404).json({ success: false, message: "Device not found." }); if (!device.snmp?.enabled) return res.status(400).json({ success: false, message: "SNMP is disabled for this device." }); return res.json({ success: true, action, result: await discoverInterfaces(device) }); }
      return res.status(400).json({ success: false, message: "Unsupported automation action. Use correlate, topology, interfaces or snapshot." });
    } catch (error) { return res.status(500).json({ success: false, message: "Automation action failed.", error: error.message }); }
  });

  router.post("/assistant", async (req, res) => {
    try {
      const question = String(req.body?.question || "").trim(); if (!question) return res.status(400).json({ success: false, message: "Question is required." });
      const [devices, incidents, samples] = await Promise.all([Device.find({}).lean(), Incident.find({ status: { $ne: "RESOLVED" } }).sort({ createdAt: -1 }).limit(100).lean(), InterfaceSample.find({}).sort({ sampledAt: -1 }).limit(100).lean()]);
      const down = devices.filter(d => d.status === "DOWN"), critical = incidents.filter(i => i.severity === "critical"), highUtil = samples.filter(s => Number(s.utilizationPercent) >= 80);
      const answer = critical.length ? `There are ${critical.length} critical active incident(s). Start with ${critical[0].device} (${critical[0].incidentId}) and inspect its upstream path before working on correlated children.` : down.length ? `${down.length} device(s) are currently DOWN. Prioritize reachability and upstream path checks for ${down[0].hostname}.` : highUtil.length ? `${highUtil.length} recent interface sample(s) show utilization at or above 80%. Inspect the affected interface(s) for congestion, errors and discards.` : "No dominant critical signal is currently visible. Review recent incidents, interface health and topology evidence.";
      return res.json({ success: true, mode: "rule-assisted", question, answer, evidence: { activeIncidents: incidents.length, criticalIncidents: critical.length, downDevices: down.length, highUtilizationSamples: highUtil.length }, generatedAt: new Date().toISOString() });
    } catch (error) { return res.status(500).json({ success: false, message: "Troubleshooting assistant failed.", error: error.message }); }
  });

  if (io) io.on?.("connection", () => {});
  return router;
}
