import express from "express";
import mongoose from "mongoose";
import Site from "../models/Site.js";
import Device from "../models/Device.js";
import { computeSiteOverview } from "../services/siteService.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const sites = await Site.find({ realmId: req.realmId }).sort({ name: 1 }).lean();

    // Per-site device/active-incident counts via one aggregation each, not
    // a per-site round trip - same reasoning as platformRoutes.js's
    // realmCounts helper.
    // aggregate() bypasses Mongoose's query-casting (unlike find/countDocuments),
    // so req.realmId - a string, since it comes off the JWT payload - must be
    // cast to ObjectId explicitly or these $match stages silently match nothing.
    const realmObjectId = new mongoose.Types.ObjectId(req.realmId);
    const [deviceRows, incidentRows] = await Promise.all([
      Device.aggregate([{ $match: { realmId: realmObjectId, siteId: { $ne: null } } }, { $group: { _id: "$siteId", count: { $sum: 1 }, down: { $sum: { $cond: [{ $eq: ["$status", "DOWN"] }, 1, 0] } } } }]),
      Device.aggregate([
        { $match: { realmId: realmObjectId, siteId: { $ne: null }, activeIncidentId: { $ne: null } } },
        { $group: { _id: "$siteId", count: { $sum: 1 } } }
      ])
    ]);
    const deviceCountBySite = new Map(deviceRows.map(row => [String(row._id), row.count]));
    const downCountBySite = new Map(deviceRows.map(row => [String(row._id), row.down]));
    const incidentCountBySite = new Map(incidentRows.map(row => [String(row._id), row.count]));

    const unassignedDeviceCount = await Device.countDocuments({ realmId: req.realmId, siteId: null });

    return res.json({
      success: true,
      sites: sites.map(site => ({ ...site, deviceCount: deviceCountBySite.get(String(site._id)) || 0, devicesDown: downCountBySite.get(String(site._id)) || 0, activeIncidentCount: incidentCountBySite.get(String(site._id)) || 0 })),
      unassignedDeviceCount
    });
  } catch (error) {
    console.error("GET SITES ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve sites.", error: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, address, description, timezone } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "Site name is required." });

    const site = await Site.create({ realmId: req.realmId, name: String(name).trim(), address: address || "", description: description || "", timezone: timezone || "UTC" });
    return res.status(201).json({ success: true, site });
  } catch (error) {
    console.error("CREATE SITE ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to create site.", error: error.message });
  }
});

router.get("/:siteId", async (req, res) => {
  try {
    const site = await Site.findOne({ _id: req.params.siteId, realmId: req.realmId }).lean();
    if (!site) return res.status(404).json({ success: false, message: "Site not found." });

    const overview = await computeSiteOverview({ realmId: req.realmId, siteId: site._id });
    return res.json({ success: true, site, ...overview });
  } catch (error) {
    console.error("GET SITE ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve site.", error: error.message });
  }
});

const PATCHABLE_FIELDS = ["name", "address", "description", "timezone"];
router.patch("/:siteId", async (req, res) => {
  try {
    const updates = {};
    for (const field of PATCHABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
    }
    const site = await Site.findOneAndUpdate({ _id: req.params.siteId, realmId: req.realmId }, { $set: updates }, { new: true, runValidators: true });
    if (!site) return res.status(404).json({ success: false, message: "Site not found." });
    return res.json({ success: true, site });
  } catch (error) {
    console.error("UPDATE SITE ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update site.", error: error.message });
  }
});

// Deleting a site never deletes or stops monitoring its devices - they're
// unassigned back to "Unassigned" instead, the same non-destructive
// preference used throughout this app (e.g. resolving vs. deleting an
// incident).
router.delete("/:siteId", async (req, res) => {
  try {
    const site = await Site.findOneAndDelete({ _id: req.params.siteId, realmId: req.realmId });
    if (!site) return res.status(404).json({ success: false, message: "Site not found." });

    const result = await Device.updateMany({ realmId: req.realmId, siteId: site._id }, { $set: { siteId: null } });
    return res.json({ success: true, siteId: req.params.siteId, devicesUnassigned: result.modifiedCount });
  } catch (error) {
    console.error("DELETE SITE ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete site.", error: error.message });
  }
});

export default router;
