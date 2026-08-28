import express from "express";
import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import InterfaceSample from "../models/InterfaceSample.js";
import ConfigSnapshot from "../models/ConfigSnapshot.js";
import { correlateActiveIncidents } from "../services/incidentCorrelationService.js";
import { computeRootCause } from "../services/rootCauseService.js";
import { discoverTopology } from "../services/topologyService.js";
import { discoverInterfaces } from "../services/snmpService.js";
import { captureSnapshot } from "../services/configSnapshotService.js";

export default function phase4Routes(io) {
  const router = express.Router();

  router.get("/overview", async (req, res) => {
    try {
      const [devices, active, recent, samples] = await Promise.all([Device.find({}).lean(), Incident.countDocuments({ status: { $nin: ["RESOLVED"] } }), Incident.find({}).sort({ createdAt: -1 }).limit(50).lean(), InterfaceSample.find({}).sort({ sampledAt: -1 }).limit(500).lean()]);
      const utilization = samples.map(s => Number(s.utilizationPercent)).filter(Number.isFinite);
      return res.json({ success: true, generatedAt: new Date().toISOString(), kpis: { devices: devices.length, activeIncidents: active, downDevices: devices.filter(d => d.status === "DOWN").length, degradedDevices: devices.filter(d => d.status === "DEGRADED").length, avgUtilization: utilization.length ? utilization.reduce((a, b) => a + b, 0) / utilization.length : 0, peakUtilization: utilization.length ? Math.max(...utilization) : 0, interfaceErrors: samples.reduce((n, s) => n + (Number(s.inErrors) || 0) + (Number(s.outErrors) || 0) + (Number(s.inDiscards) || 0) + (Number(s.outDiscards) || 0), 0) }, devices: devices.map(d => ({ deviceId: d.deviceId, hostname: d.hostname, ipAddress: d.ipAddress, status: d.status, vendor: d.vendor, deviceType: d.deviceType, activeIncidentId: d.activeIncidentId })), recentIncidents: recent });
    } catch (error) { return res.status(500).json({ success: false, message: "Failed to load Phase 4 overview.", error: error.message }); }
  });

  router.get("/analytics", async (req, res) => {
    try {
      const hours = Math.min(Math.max(Number.parseInt(req.query.hours || "24", 10) || 24, 1), 168);
      const since = new Date(Date.now() - hours * 3600 * 1000);
      const [incidents, samples] = await Promise.all([Incident.find({ createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean(), InterfaceSample.find({ sampledAt: { $gte: since } }).sort({ sampledAt: 1 }).lean()]);
      const buckets = new Map();
      for (const incident of incidents) { const key = new Date(incident.createdAt).toISOString().slice(0, 13) + ":00:00.000Z"; const bucket = buckets.get(key) || { time: key, incidents: 0, critical: 0, resolved: 0 }; bucket.incidents += 1; if (incident.severity === "critical") bucket.critical += 1; if (incident.status === "RESOLVED") bucket.resolved += 1; buckets.set(key, bucket); }
      const utilization = samples.map(s => Number(s.utilizationPercent)).filter(Number.isFinite);
      return res.json({ success: true, windowHours: hours, summary: { incidentCount: incidents.length, sampleCount: samples.length, averageUtilization: utilization.length ? utilization.reduce((a, b) => a + b, 0) / utilization.length : 0, peakUtilization: utilization.length ? Math.max(...utilization) : 0 }, timeline: [...buckets.values()] });
    } catch (error) { return res.status(500).json({ success: false, message: "Failed to load analytics.", error: error.message }); }
  });

  router.get("/rca", async (req, res) => {
    try {
      const correlation = await correlateActiveIncidents({ forceTopology: req.query.refresh === "true" });
      const devices = await Device.find({}).lean();
      const incidents = correlation.incidents || [];
      const groups = correlation.groups || [];
      const groupMap = new Map(groups.map(group => [group.rootIncidentId, group]));
      const analyses = incidents.map(incident => {
        const device = devices.find(d => {
          const values = [d.deviceId, d.hostname, d.ipAddress].map(v => String(v || "").trim().toLowerCase());
          const target = String(incident.device || "").trim().toLowerCase();
          return target && values.some(v => v === target || v.includes(target) || target.includes(v));
        });
        const group = incident.correlationRole === "CHILD" ? groups.find(g => g.children.some(child => child.incidentId === incident.incidentId)) : groupMap.get(incident.incidentId);
        // A root's rootCause is already computed (with its correlated children factored
        // in) by the correlation engine - reuse it instead of recomputing. Everything
        // else (children, standalone) gets its own single-incident analysis.
        const rootCause = incident.correlationRole === "ROOT" && group?.rootCause ? group.rootCause : computeRootCause(incident, { device, children: [] });
        const pathEvidence = group?.children?.find(child => child.incidentId === incident.incidentId)?.path || [];
        return {
          incidentId: incident.incidentId, device: incident.device, severity: incident.severity, status: incident.status,
          role: incident.correlationRole || "STANDALONE", correlationGroupId: incident.correlationGroupId || null, parentIncidentId: incident.parentIncidentId || null,
          blastRadius: group?.blastRadius ? group.blastRadius + 1 : 1, topologyPath: pathEvidence,
          rootCause, cause: rootCause.description, confidence: rootCause.confidence, evidence: rootCause.evidence,
          nextAction: incident.correlationRole === "ROOT" ? "Validate the root-device fault first, then inspect the listed downstream symptoms." : incident.correlationRole === "CHILD" ? "Treat this as a correlated symptom until the parent/root incident is cleared." : rootCause.confidence >= 80 ? "Validate the indicated fault and inspect interface/path evidence." : "Collect interface, path and device evidence before escalating."
        };
      });
      return res.json({ success: true, generatedAt: new Date().toISOString(), topologyGeneratedAt: correlation.topologyGeneratedAt || null, activeIncidents: correlation.activeIncidents || incidents.length, correlatedGroups: correlation.correlatedGroups || groups.length, suppressedChildren: correlation.suppressedChildren || 0, groups, analyses, devices: devices.map(d => ({ deviceId: d.deviceId, hostname: d.hostname, status: d.status })) });
    } catch (error) { console.error("PHASE4 RCA ERROR:", error); return res.status(500).json({ success: false, message: "Failed to build topology-aware RCA analysis.", error: error.message }); }
  });

  router.get("/config-changes", async (req, res) => {
    try {
      const snapshots = await ConfigSnapshot.find({}).sort({ capturedAt: -1 }).limit(200).lean();
      const latest = new Map(); const changes = [];
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
      if (action === "correlate") return res.json({ success: true, action, result: await correlateActiveIncidents({ forceTopology: true }) });
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
      const down = devices.filter(d => d.status === "DOWN"); const critical = incidents.filter(i => i.severity === "critical"); const highUtil = samples.filter(s => Number(s.utilizationPercent) >= 80);
      const answer = critical.length ? `There are ${critical.length} critical active incident(s). Start with ${critical[0].device} (${critical[0].incidentId}) and inspect its upstream path before working on correlated children.` : down.length ? `${down.length} device(s) are currently DOWN. Prioritize reachability and upstream path checks for ${down[0].hostname}.` : highUtil.length ? `${highUtil.length} recent interface sample(s) show utilization at or above 80%. Inspect the affected interface(s) for congestion, errors and discards.` : "No dominant critical signal is currently visible. Review recent incidents, interface health and topology evidence.";
      return res.json({ success: true, mode: "rule-assisted", question, answer, evidence: { activeIncidents: incidents.length, criticalIncidents: critical.length, downDevices: down.length, highUtilizationSamples: highUtil.length }, generatedAt: new Date().toISOString() });
    } catch (error) { return res.status(500).json({ success: false, message: "Troubleshooting assistant failed.", error: error.message }); }
  });

  if (io) io.on?.("connection", () => {});
  return router;
}
