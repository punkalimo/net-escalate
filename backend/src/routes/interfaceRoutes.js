import express from "express";
import Device from "../models/Device.js";
import InterfaceSample from "../models/InterfaceSample.js";
import { getInterfaceStatus, getInterfaceMetrics, testSnmpConnection } from "../services/snmpService.js";
import { syncDeviceInterfacesAdmin, pollDeviceInterfaces } from "../services/interfaceMonitoringService.js";

const router = express.Router();

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

    // Manually-triggered discovery runs the same admin-sync upsert the slow
    // background cadence uses (identity/admin fields only, ifIndex-keyed,
    // never a full-array replace - existing `monitored` overrides and
    // operational/health state survive), then one immediate operational
    // poll so the response carries fresh status/traffic instead of making
    // the caller wait for the next scheduled cycle.
    const syncResult = await syncDeviceInterfacesAdmin(device.deviceId);
    const pollResult = await pollDeviceInterfaces(device.deviceId);
    const interfaces = pollResult.device?.interfaces || syncResult.device?.interfaces || [];

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

// Manual override for the per-interface monitored flag - discovery only
// sets a default (admin-up at first discovery = monitored), an operator
// uses this to opt a port in or out afterward. Preserved across
// re-discovery since that path never touches this field on an existing
// interface (see upsertDiscoveredInterfaces).
router.patch("/:deviceId/:ifIndex/monitored", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: "Device not found." });
    const ifIndex = Number(req.params.ifIndex);
    if (!Number.isInteger(ifIndex) || ifIndex < 1) return res.status(400).json({ success: false, message: "Invalid interface index." });
    if (typeof req.body?.monitored !== "boolean") return res.status(400).json({ success: false, message: "Body must include a boolean `monitored` field." });

    const iface = device.interfaces.find(item => Number(item.ifIndex) === ifIndex);
    if (!iface) return res.status(404).json({ success: false, message: `Interface ${ifIndex} not found on ${device.hostname}.` });

    iface.monitored = req.body.monitored;
    await device.save();
    if (global.io) global.io.emit("device_updated", device.toObject());
    return res.json({ success: true, deviceId: device.deviceId, ifIndex, monitored: iface.monitored });
  } catch (error) {
    console.error("INTERFACE MONITORED TOGGLE ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update interface monitoring flag.", error: error.message });
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
