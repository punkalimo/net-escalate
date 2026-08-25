import express from "express";
import Device from "../models/Device.js";
import InterfaceSample from "../models/InterfaceSample.js";
import { discoverInterfaces, getInterfaceStatus, getInterfaceMetrics, testSnmpConnection } from "../services/snmpService.js";

const router = express.Router();

function counterDelta(current, previous) {
  if (previous == null || current == null || current < previous) return null;
  return current - previous;
}

function calculateRates(metrics, previousMetrics) {
  if (!previousMetrics?.checkedAt || !metrics.checkedAt) return { inBps: null, outBps: null, utilizationPercent: null };
  const elapsedSeconds = (new Date(metrics.checkedAt).getTime() - new Date(previousMetrics.checkedAt).getTime()) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return { inBps: null, outBps: null, utilizationPercent: null };
  const inDelta = counterDelta(metrics.inOctets, previousMetrics.inOctets);
  const outDelta = counterDelta(metrics.outOctets, previousMetrics.outOctets);
  const inBps = inDelta == null ? null : (inDelta * 8) / elapsedSeconds;
  const outBps = outDelta == null ? null : (outDelta * 8) / elapsedSeconds;
  const capacityBps = metrics.speedMbps ? metrics.speedMbps * 1000000 : null;
  const utilizationPercent = capacityBps ? Math.min(100, Math.max(inBps || 0, outBps || 0) / capacityBps * 100) : null;
  return { inBps, outBps, utilizationPercent };
}

router.post("/:deviceId/discover", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: "Device not found." });

    if (device.snmp?.enabled === false) {
      return res.status(400).json({
        success: false,
        code: "SNMP_DISABLED",
        message: `SNMP monitoring is disabled for ${device.hostname}. Enable SNMP in the device settings first.`
      });
    }

    if (!["1", "2c", "3", 1, 2, 3].includes(device.snmp?.version || "2c")) {
      return res.status(400).json({
        success: false,
        code: "SNMP_VERSION_UNSUPPORTED",
        message: `SNMP ${device.snmp?.version || "unknown"} is not supported by the discovery engine.`
      });
    }

    // Validate credentials and reachability before starting a potentially
    // long interface walk. This gives the UI a useful failure reason.
    try {
      await testSnmpConnection(device);
    } catch (snmpError) {
      const reason = snmpError?.code ? `${snmpError.message} (${snmpError.code})` : (snmpError?.message || String(snmpError));
      return res.status(502).json({
        success: false,
        code: "SNMP_UNREACHABLE",
        message: `SNMP connection to ${device.hostname} (${device.ipAddress}) failed. Verify SNMP is enabled and the configured version/credentials are correct. ${reason}`,
        error: reason
      });
    }

    const discovered = await discoverInterfaces(device);
    const previousInterfaces = (device.interfaces || []).reduce((map, item) => {
      if (item.name) map[item.name] = item;
      return map;
    }, {});

    const interfaces = await Promise.all(discovered.map(async item => {
      const name = item.displayName || item.ifName || item.ifDescr || `Interface ${item.ifIndex}`;
      let status = "UNKNOWN";
      let metrics = null;
      try { status = (await getInterfaceStatus(device, item.ifIndex)).operState || "UNKNOWN"; }
      catch (error) { console.warn(`[INTERFACE DISCOVERY] Status unavailable for ${name}: ${error.message}`); }
      try { metrics = await getInterfaceMetrics(device, item.ifIndex); }
      catch (error) { console.warn(`[INTERFACE DISCOVERY] Metrics unavailable for ${name}: ${error.message}`); }
      const previous = previousInterfaces[name]?.metrics;
      const rates = metrics ? calculateRates(metrics, previous) : { inBps: null, outBps: null, utilizationPercent: null };
      return {
        name,
        description: item.ifAlias || item.ifDescr || name,
        ipAddress: "",
        status,
        lastCheckedAt: new Date(),
        ifIndex: item.ifIndex,
        metrics: metrics ? { ...metrics, ...rates } : null
      };
    }));

    await Device.collection.updateOne({ deviceId: device.deviceId }, { $set: { interfaces, updatedAt: new Date() } });
    if (global.io) global.io.emit("device_updated", { ...device.toObject(), interfaces });
    return res.json({
      success: true,
      deviceId: device.deviceId,
      vendor: device.vendor,
      model: device.model,
      snmpVersion: device.snmp?.version || "2c",
      count: interfaces.length,
      interfaces
    });
  } catch (error) {
    console.error("INTERFACE DISCOVERY ERROR:", error);
    const reason = error?.code ? `${error.message} (${error.code})` : (error?.message || String(error));
    return res.status(500).json({
      success: false,
      code: "INTERFACE_DISCOVERY_FAILED",
      message: `Interface discovery failed for ${req.params.deviceId}: ${reason}`,
      error: reason
    });
  }
});

router.get("/:deviceId/history", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).lean();
    if (!device) return res.status(404).json({ success: false, message: "Device not found." });
    const hours = Math.min(168, Math.max(1, Number(req.query.hours || 24)));
    const ifIndex = req.query.ifIndex == null ? null : Number(req.query.ifIndex);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const query = { deviceId: device.deviceId, sampledAt: { $gte: since } };
    if (Number.isInteger(ifIndex) && ifIndex > 0) query.ifIndex = ifIndex;
    const samples = await InterfaceSample.find(query).sort({ sampledAt: 1 }).lean();
    return res.json({ success: true, deviceId: device.deviceId, hours, samples });
  } catch (error) {
    console.error("INTERFACE HISTORY ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve interface history.", error: error.message });
  }
});

router.get("/:deviceId", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).lean();
    if (!device) return res.status(404).json({ success: false, message: "Device not found." });
    return res.json({ success: true, deviceId: device.deviceId, interfaces: device.interfaces || [] });
  } catch (error) {
    console.error("GET INTERFACES ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve interfaces.", error: error.message });
  }
});

router.get("/:deviceId/:ifIndex/status", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: "Device not found." });
    const ifIndex = Number(req.params.ifIndex);
    if (!Number.isInteger(ifIndex) || ifIndex < 1) return res.status(400).json({ success: false, message: "Invalid interface index." });
    return res.json({ success: true, deviceId: device.deviceId, status: await getInterfaceStatus(device, ifIndex) });
  } catch (error) {
    console.error("INTERFACE STATUS ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve interface status.", error: error.message });
  }
});

router.get("/:deviceId/:ifIndex/metrics", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: "Device not found." });
    const ifIndex = Number(req.params.ifIndex);
    if (!Number.isInteger(ifIndex) || ifIndex < 1) return res.status(400).json({ success: false, message: "Invalid interface index." });
    return res.json({ success: true, deviceId: device.deviceId, metrics: await getInterfaceMetrics(device, ifIndex) });
  } catch (error) {
    console.error("INTERFACE METRICS ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve interface metrics.", error: error.message });
  }
});

export default router;
