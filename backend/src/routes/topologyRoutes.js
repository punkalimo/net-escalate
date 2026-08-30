import express from "express";
import { discoverTopology } from "../services/topologyService.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    return res.json(await discoverTopology(req.realmId));
  } catch (error) {
    console.error("TOPOLOGY DISCOVERY ERROR:", error);
    return res.status(500).json({ success: false, message: "Topology discovery failed.", error: error.message });
  }
});

router.post("/discover", async (req, res) => {
  try {
    return res.json(await discoverTopology(req.realmId));
  } catch (error) {
    console.error("TOPOLOGY DISCOVERY ERROR:", error);
    return res.status(500).json({ success: false, message: "Topology discovery failed.", error: error.message });
  }
});

export default router;
