import express from "express";
import Device from "../models/Device.js";
import {
  discoverInterfaces,
  getInterfaceStatus,
  getInterfaceMetrics
} from "../services/snmpService.js";

const router = express.Router();

function counterDelta(current, previous) {
  if (previous == null || current == null || current < previous) return null;
  return current - previous;
}

function calculateRates(metrics, previousMetrics) {
  if (!previousMetrics?.checkedAt || !metrics.checkedAt) {
    return { inBps: null, outBps: null, utilizationPercent: null };
  }

  const elapsedSeconds =
    (new Date(metrics.checkedAt).getTime() - new Date(previousMetrics.checkedAt).getTime()) / 1000;

  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return { inBps: null, outBps: null, utilizationPercent: null };
  }

  const inDelta = counterDelta(metrics.inOctets, previousMetrics.inOctets);
  const outDelta = counterDelta(metrics.outOctets, previousMetrics.outOctets);
  const inBps = inDelta == null ? null : (inDelta * 8) / elapsedSeconds;
  const outBps = outDelta == null ? null : (outDelta * 8) / elapsedSeconds;
  const capacityBps = metrics.speedMbps ? metrics.speedMbps * 1000000 : null;
  const utilizationPercent = capacityBps
    ? Math.min(100, ((Math.max(inBps || 0, outBps || 0)) / capacityBps) * 100)
    : null;

  return { inBps, outBps, utilizationPercent };
}

router.post("/:deviceId/discover", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    const discovered = await discoverInterfaces(device);
    const previousInterfaces = (device.interfaces || []).reduce((map, item) => {
      if (item.name) map[item.name] = item;
      return map;
    }, {});

    const interfaces = await Promise.all(
      discovered.map(async item => {
        const name = item.ifDescr || `Interface ${item.ifIndex}`;
        let status = "UNKNOWN";
        let metrics = null;

        try {
          const state = await getInterfaceStatus(device, item.ifIndex);
          status = state.operState || "UNKNOWN";
        } catch (statusError) {
          console.warn(`INTERFACE STATUS ERROR for ${name}:`, statusError.message);
        }

        try {
          metrics = await getInterfaceMetrics(device, item.ifIndex);
        } catch (metricsError) {
          console.warn(`INTERFACE METRICS ERROR for ${name}:`, metricsError.message);
        }

        const previous = previousInterfaces[name]?.metrics;
        const rates = metrics ? calculateRates(metrics, previous) : {
          inBps: null, outBps: null, utilizationPercent: null
        };

        return {
          name,
          description: name,
          ipAddress: "",
          status,
          lastCheckedAt: new Date(),
          ifIndex: item.ifIndex,
          metrics: metrics ? { ...metrics, ...rates } : null
        };
      })
    );

    // Use the native collection update so newly added metric fields are
    // retained without changing the existing Mongoose interface schema yet.
    await Device.collection.updateOne(
      { deviceId: device.deviceId },
      { $set: { interfaces, updatedAt: new Date() } }
    );

    return res.json({ success: true, deviceId: device.deviceId, interfaces });
  } catch (error) {
    console.error("INTERFACE DISCOVERY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to discover interfaces.",
      error: error.message
    });
  }
});

router.get("/:deviceId", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).lean();
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }
    return res.json({
      success: true,
      deviceId: device.deviceId,
      interfaces: device.interfaces || []
    });
  } catch (error) {
    console.error("GET INTERFACES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve interfaces.",
      error: error.message
    });
  }
});

router.get("/:deviceId/:ifIndex/status", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    const ifIndex = Number(req.params.ifIndex);
    if (!Number.isInteger(ifIndex) || ifIndex < 1) {
      return res.status(400).json({ success: false, message: "Invalid interface index." });
    }

    const status = await getInterfaceStatus(device, ifIndex);
    return res.json({ success: true, deviceId: device.deviceId, status });
  } catch (error) {
    console.error("INTERFACE STATUS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve interface status.",
      error: error.message
    });
  }
});

router.get("/:deviceId/:ifIndex/metrics", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    const ifIndex = Number(req.params.ifIndex);
    if (!Number.isInteger(ifIndex) || ifIndex < 1) {
      return res.status(400).json({ success: false, message: "Invalid interface index." });
    }

    const metrics = await getInterfaceMetrics(device, ifIndex);
    return res.json({ success: true, deviceId: device.deviceId, metrics });
  } catch (error) {
    console.error("INTERFACE METRICS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve interface metrics.",
      error: error.message
    });
  }
});

export default router;
