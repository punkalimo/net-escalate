import express from "express";
import { discoverDevicePath } from "../services/devicePathService.js";

const router = express.Router();

router.get("/devices/:deviceId/path", async (req, res) => {
  try {
    const result = await discoverDevicePath(req.params.deviceId, req.realmId);
    return res.status(result.status || 200).json(result);
  } catch (error) {
    console.error("DEVICE PATH DISCOVERY ERROR:", error);
    return res.status(500).json({ success: false, message: "Device path discovery failed.", error: error.message });
  }
});

router.post("/devices/:deviceId/path/discover", async (req, res) => {
  try {
    const result = await discoverDevicePath(req.params.deviceId, req.realmId);
    return res.status(result.status || 200).json(result);
  } catch (error) {
    console.error("DEVICE PATH DISCOVERY ERROR:", error);
    return res.status(500).json({ success: false, message: "Device path discovery failed.", error: error.message });
  }
});

export default router;
