import express from "express";
import Device from "../models/Device.js";
import { discoverInterfaces, getInterfaceStatus } from "../services/snmpService.js";

const router = express.Router();

router.post("/:deviceId/discover", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });

    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    const discovered = await discoverInterfaces(device);

    const interfaces = discovered.map((item) => ({
      name: item.ifDescr || `Interface ${item.ifIndex}`,
      description: item.ifDescr || "",
      status: item.ifOperStatus === 1 ? "UP" : item.ifOperStatus === 2 ? "DOWN" : "UNKNOWN",
      lastCheckedAt: new Date()
    }));

    device.interfaces = interfaces;
    await device.save();

    return res.json({
      success: true,
      deviceId: device.deviceId,
      interfaces
    });
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
    const device = await Device.findOne({ deviceId: req.params.deviceId });

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

export default router;
