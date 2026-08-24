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

    const interfaces = await discoverInterfaces(device);

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
