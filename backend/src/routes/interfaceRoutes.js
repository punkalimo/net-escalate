import express from "express";
import Device from "../models/Device.js";
import { discoverInterfaces } from "../services/snmpService.js";

const router = express.Router();

router.post("/:deviceId/discover", async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });

    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    if (!device.snmp?.enabled) {
      return res.status(400).json({ success: false, message: "SNMP is not enabled for this device." });
    }

    const discovered = await discoverInterfaces(device);

    const interfaces = discovered
      .filter(item => item.ifDescr)
      .map(item => ({
        name: item.ifDescr,
        description: item.ifDescr,
        ipAddress: "",
        status: item.ifOperStatus === 1 ? "UP" : item.ifOperStatus === 2 ? "DOWN" : "UNKNOWN",
        lastCheckedAt: new Date()
      }));

    device.interfaces = interfaces;
    await device.save();

    return res.json({
      success: true,
      message: `Discovered ${interfaces.length} interface(s).`,
      interfaces,
      device
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
    const device = await Device.findOne({ deviceId: req.params.deviceId }).lean();

    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found." });
    }

    return res.json({ success: true, interfaces: device.interfaces || [] });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve interfaces.",
      error: error.message
    });
  }
});

export default router;
