import express from "express";
import mongoose from "mongoose";
import Realm from "../models/Realm.js";
import Technician from "../models/Technician.js";
import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import Site from "../models/Site.js";
import AuditLog from "../models/AuditLog.js";
import { computeIncidentOverview } from "../services/dashboardService.js";
import { computeTechnicianPerformance } from "../services/technicianPerformanceService.js";
import { computePlatformSitePerformance } from "../services/platformPerformanceService.js";
import { signRealmContext, hashPassword, REALM_CONTEXT_COOKIE_NAME, REALM_CONTEXT_COOKIE_MAX_AGE_MS } from "../services/authService.js";
import { logAudit } from "../services/auditLogService.js";

const REALM_CONTEXT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: REALM_CONTEXT_COOKIE_MAX_AGE_MS
};

function toObjectId(id) {
  return mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null;
}

export default function platformRoutes() {
  const router = express.Router();

  // Cross-realm counts via a single aggregation per collection, grouped by
  // realmId - never "load every document and count in JS" (see the plan's
  // performance requirement). $group on a missing realm produces no row,
  // which is fine: a realm with 0 devices/technicians/incidents just isn't
  // in the map, and the code below defaults it to 0.
  async function realmCounts(realmIds) {
    const match = realmIds ? { realmId: { $in: realmIds } } : {};
    const [deviceRows, technicianRows, incidentRows, activeIncidentRows] = await Promise.all([
      Device.aggregate([{ $match: match }, { $group: { _id: "$realmId", count: { $sum: 1 } } }]),
      Technician.aggregate([{ $match: { ...match, platformRole: null } }, { $group: { _id: "$realmId", count: { $sum: 1 } } }]),
      Incident.aggregate([{ $match: match }, { $group: { _id: "$realmId", count: { $sum: 1 } } }]),
      Incident.aggregate([{ $match: { ...match, status: { $ne: "RESOLVED" } } }, { $group: { _id: "$realmId", count: { $sum: 1 } } }])
    ]);
    const toMap = rows => new Map(rows.map(row => [String(row._id), row.count]));
    return { devices: toMap(deviceRows), technicians: toMap(technicianRows), incidents: toMap(incidentRows), activeIncidents: toMap(activeIncidentRows) };
  }

  // GET /realms - list every realm with aggregated counts, paginated.
  router.get("/realms", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "50", 10) || 50, 1), 200);
      const skip = Math.max(Number.parseInt(req.query.skip || "0", 10) || 0, 0);
      const filter = {};
      if (req.query.status && req.query.status !== "ALL") filter.status = req.query.status;
      if (req.query.industry && req.query.industry !== "ALL") filter.industry = req.query.industry;
      if (req.query.search) filter.name = { $regex: String(req.query.search).trim(), $options: "i" };

      const [realms, total] = await Promise.all([
        Realm.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Realm.countDocuments(filter)
      ]);

      const counts = await realmCounts(realms.map(r => r._id));
      const enriched = realms.map(realm => {
        const key = String(realm._id);
        return {
          ...realm,
          deviceCount: counts.devices.get(key) || 0,
          technicianCount: counts.technicians.get(key) || 0,
          incidentCount: counts.incidents.get(key) || 0,
          activeIncidentCount: counts.activeIncidents.get(key) || 0
        };
      });

      return res.json({ success: true, realms: enriched, pagination: { total, limit, skip, returned: realms.length, hasMore: skip + realms.length < total } });
    } catch (error) {
      console.error("PLATFORM REALMS LIST ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to list realms.", error: error.message });
    }
  });

  router.post("/realms", async (req, res) => {
    try {
      const { name, slug, description, industry, timezone, subscriptionPlan, maxDevices, maxUsers, maxTechnicians } = req.body || {};
      if (!name || !slug) return res.status(400).json({ success: false, message: "Realm name and slug are required." });

      const realm = await Realm.create({ name: String(name).trim(), slug: String(slug).trim().toLowerCase(), description: description || "", industry: industry || "Other", timezone: timezone || "UTC", subscriptionPlan: subscriptionPlan || "starter", maxDevices: maxDevices ?? null, maxUsers: maxUsers ?? null, maxTechnicians: maxTechnicians ?? null });
      await logAudit({ actor: req.user, targetType: "Realm", targetId: realm._id, action: "REALM_CREATED", metadata: { name: realm.name, slug: realm.slug }, req });
      return res.status(201).json({ success: true, realm });
    } catch (error) {
      console.error("PLATFORM REALM CREATE ERROR:", error);
      const duplicate = error?.code === 11000;
      return res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "A realm with this slug already exists." : "Failed to create realm.", error: error.message });
    }
  });

  router.get("/realms/:id", async (req, res) => {
    try {
      const realmObjectId = toObjectId(req.params.id);
      if (!realmObjectId) return res.status(400).json({ success: false, message: "Invalid realm id." });

      const realm = await Realm.findById(realmObjectId).lean();
      if (!realm) return res.status(404).json({ success: false, message: "Realm not found." });

      const [overview, counts] = await Promise.all([
        computeIncidentOverview({ realmId: realmObjectId }),
        realmCounts([realmObjectId])
      ]);
      const key = String(realmObjectId);

      return res.json({
        success: true,
        realm: { ...realm, deviceCount: counts.devices.get(key) || 0, technicianCount: counts.technicians.get(key) || 0, incidentCount: counts.incidents.get(key) || 0, activeIncidentCount: counts.activeIncidents.get(key) || 0 },
        overview
      });
    } catch (error) {
      console.error("PLATFORM REALM DETAIL ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to load realm detail.", error: error.message });
    }
  });

  // Edit/suspend/activate - one PATCH, status included in the same
  // whitelist as the other editable fields (a real subscription/usage
  // system would likely separate these, but there's no billing here yet).
  const REALM_PATCHABLE_FIELDS = ["name", "description", "industry", "timezone", "status", "subscriptionPlan", "maxDevices", "maxUsers", "maxTechnicians"];
  router.patch("/realms/:id", async (req, res) => {
    try {
      const realmObjectId = toObjectId(req.params.id);
      if (!realmObjectId) return res.status(400).json({ success: false, message: "Invalid realm id." });

      const updates = {};
      for (const field of REALM_PATCHABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
      }

      const realm = await Realm.findByIdAndUpdate(realmObjectId, { $set: updates }, { new: true, runValidators: true });
      if (!realm) return res.status(404).json({ success: false, message: "Realm not found." });

      const action = updates.status === "suspended" ? "REALM_SUSPENDED" : updates.status === "active" ? "REALM_ACTIVATED" : "REALM_EDITED";
      await logAudit({ actor: req.user, targetType: "Realm", targetId: realm._id, action, metadata: updates, req });
      return res.json({ success: true, realm });
    } catch (error) {
      console.error("PLATFORM REALM UPDATE ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to update realm.", error: error.message });
    }
  });

  // Enter Realm: issues the short-lived realm-context cookie (separate from
  // the main identity token - see authService.js's comment on why) and
  // audits the entry. Exit just clears the cookie.
  router.post("/realms/:id/enter", async (req, res) => {
    try {
      const realmObjectId = toObjectId(req.params.id);
      if (!realmObjectId) return res.status(400).json({ success: false, message: "Invalid realm id." });

      const realm = await Realm.findById(realmObjectId).select("name status").lean();
      if (!realm) return res.status(404).json({ success: false, message: "Realm not found." });

      const token = signRealmContext({ realmId: realmObjectId, realmName: realm.name, enteredBy: req.user.technicianId });
      res.cookie(REALM_CONTEXT_COOKIE_NAME, token, REALM_CONTEXT_COOKIE_OPTIONS);
      await logAudit({ actor: req.user, realmId: realmObjectId, targetType: "Realm", targetId: realmObjectId, action: "PLATFORM_ENTERED_REALM", metadata: { realmName: realm.name, reason: req.body?.reason || null }, req });
      return res.json({ success: true, realm: { realmId: String(realmObjectId), realmName: realm.name } });
    } catch (error) {
      console.error("PLATFORM ENTER REALM ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to enter realm.", error: error.message });
    }
  });

  router.post("/exit-realm", async (req, res) => {
    const context = req.cookies?.[REALM_CONTEXT_COOKIE_NAME];
    res.clearCookie(REALM_CONTEXT_COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    if (context) {
      logAudit({ actor: req.user, targetType: "Realm", action: "PLATFORM_EXITED_REALM", req });
    }
    return res.json({ success: true });
  });

  // GET /overview - Command Center top cards.
  router.get("/overview", async (req, res) => {
    try {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [realmCount, userCount, technicianCount, deviceCount, activeIncidentCount, escalationsToday] = await Promise.all([
        Realm.countDocuments({}),
        Technician.countDocuments({ platformRole: null, username: { $ne: null } }),
        Technician.countDocuments({ platformRole: null }),
        Device.countDocuments({}),
        Incident.countDocuments({ status: { $ne: "RESOLVED" } }),
        Incident.countDocuments({ "escalationHistory.startedAt": { $gte: since } })
      ]);
      return res.json({ success: true, generatedAt: new Date().toISOString(), realms: realmCount, users: userCount, technicians: technicianCount, devices: deviceCount, activeIncidents: activeIncidentCount, escalationsToday });
    } catch (error) {
      console.error("PLATFORM OVERVIEW ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to load platform overview.", error: error.message });
    }
  });

  // Cross-realm listings - each row carries its realm's name via a small
  // in-memory join (realm count is small; this is not the N+1 the plan
  // warns against, which is about per-row queries, not one extra lookup map).
  async function realmNameMap(realmIds) {
    const realms = await Realm.find({ _id: { $in: realmIds } }).select("name").lean();
    return new Map(realms.map(r => [String(r._id), r.name]));
  }

  router.get("/technicians", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10) || 100, 1), 500);
      const skip = Math.max(Number.parseInt(req.query.skip || "0", 10) || 0, 0);
      const filter = { platformRole: null };
      if (req.query.realmId) filter.realmId = toObjectId(req.query.realmId);

      const [technicians, total] = await Promise.all([
        Technician.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Technician.countDocuments(filter)
      ]);
      const names = await realmNameMap(technicians.map(t => t.realmId).filter(Boolean));
      // .lean() returns plain objects, bypassing the schema's toJSON
      // transform that normally strips passwordHash on every other route in
      // this app - replicate that transform by hand here so the platform
      // admin's browser never receives a bcrypt hash over the wire.
      return res.json({ success: true, technicians: technicians.map(t => { const { passwordHash, ...rest } = t; return { ...rest, hasLogin: !!passwordHash, realmName: names.get(String(t.realmId)) || null }; }), pagination: { total, limit, skip, returned: technicians.length, hasMore: skip + technicians.length < total } });
    } catch (error) {
      console.error("PLATFORM TECHNICIANS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to list technicians.", error: error.message });
    }
  });

  // Detail/edit/credential-reset for a single technician, reachable
  // directly - unlike the realm-scoped equivalents in technicianRoutes.js,
  // these deliberately do NOT filter by realmId (this whole router sits
  // behind requirePlatform, before attachRealmScope even runs - see
  // server.js) so a platform admin can act on any realm's technician
  // without first Entering it. technicianId is globally unique (schema
  // constraint), so a bare findOne/findOneAndUpdate by it is unambiguous.
  const PLATFORM_TECHNICIAN_PATCHABLE_FIELDS = ["name", "phone", "role", "active"];

  router.get("/technicians/:id", async (req, res) => {
    try {
      const technician = await Technician.findOne({ technicianId: req.params.id });
      if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
      const realm = technician.realmId ? await Realm.findById(technician.realmId).select("name").lean() : null;
      return res.json({ success: true, technician, realmName: realm?.name || null });
    } catch (error) {
      console.error("PLATFORM TECHNICIAN DETAIL ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve technician.", error: error.message });
    }
  });

  router.patch("/technicians/:id", async (req, res) => {
    try {
      const updates = {};
      for (const field of PLATFORM_TECHNICIAN_PATCHABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
      }
      const technician = await Technician.findOneAndUpdate({ technicianId: req.params.id }, { $set: updates }, { new: true, runValidators: true });
      if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });
      await logAudit({ actor: req.user, realmId: technician.realmId, targetType: "Technician", targetId: technician.technicianId, action: "PLATFORM_TECHNICIAN_UPDATED", metadata: updates, req });
      return res.json({ success: true, technician });
    } catch (error) {
      console.error("PLATFORM TECHNICIAN UPDATE ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to update technician.", error: error.message });
    }
  });

  router.post("/technicians/:id/credentials", async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!username || password.length < 8) return res.status(400).json({ success: false, message: "Username and an at-least-8-character password are required." });

      const technician = await Technician.findOne({ technicianId: req.params.id });
      if (!technician) return res.status(404).json({ success: false, message: "Technician not found." });

      technician.username = username;
      technician.passwordHash = await hashPassword(password);
      await technician.save();
      await logAudit({ actor: req.user, realmId: technician.realmId, targetType: "Technician", targetId: technician.technicianId, action: "PLATFORM_TECHNICIAN_CREDENTIALS_RESET", req });
      return res.json({ success: true, technician });
    } catch (error) {
      console.error("PLATFORM TECHNICIAN CREDENTIALS ERROR:", error);
      const duplicate = error?.code === 11000;
      return res.status(duplicate ? 409 : 500).json({ success: false, message: duplicate ? "That username is already taken." : "Failed to set login credentials." });
    }
  });

  router.get("/devices", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10) || 100, 1), 500);
      const skip = Math.max(Number.parseInt(req.query.skip || "0", 10) || 0, 0);
      const filter = {};
      if (req.query.realmId) filter.realmId = toObjectId(req.query.realmId);
      if (req.query.status && req.query.status !== "ALL") filter.status = req.query.status;

      const [devices, total] = await Promise.all([
        Device.find(filter).select("deviceId hostname ipAddress vendor model deviceType status lastSeenAt activeIncidentId realmId").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Device.countDocuments(filter)
      ]);
      const names = await realmNameMap(devices.map(d => d.realmId).filter(Boolean));
      return res.json({ success: true, devices: devices.map(d => ({ ...d, realmName: names.get(String(d.realmId)) || null })), pagination: { total, limit, skip, returned: devices.length, hasMore: skip + devices.length < total } });
    } catch (error) {
      console.error("PLATFORM DEVICES ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to list devices.", error: error.message });
    }
  });

  // Cross-realm site rollup - generalizes siteRoutes.js's GET / (same
  // per-site device/down/active-incident aggregation, no realmId $match).
  router.get("/sites", async (req, res) => {
    try {
      const filter = {};
      if (req.query.realmId) filter.realmId = toObjectId(req.query.realmId);

      const sites = await Site.find(filter).sort({ name: 1 }).lean();
      const [deviceRows, incidentRows] = await Promise.all([
        Device.aggregate([{ $match: { siteId: { $ne: null } } }, { $group: { _id: "$siteId", count: { $sum: 1 }, down: { $sum: { $cond: [{ $eq: ["$status", "DOWN"] }, 1, 0] } } } }]),
        Device.aggregate([
          { $match: { siteId: { $ne: null }, activeIncidentId: { $ne: null } } },
          { $group: { _id: "$siteId", count: { $sum: 1 } } }
        ])
      ]);
      const deviceCountBySite = new Map(deviceRows.map(row => [String(row._id), row.count]));
      const downCountBySite = new Map(deviceRows.map(row => [String(row._id), row.down]));
      const incidentCountBySite = new Map(incidentRows.map(row => [String(row._id), row.count]));
      const names = await realmNameMap(sites.map(s => s.realmId).filter(Boolean));

      return res.json({
        success: true,
        sites: sites.map(site => ({ ...site, realmName: names.get(String(site.realmId)) || null, deviceCount: deviceCountBySite.get(String(site._id)) || 0, devicesDown: downCountBySite.get(String(site._id)) || 0, activeIncidentCount: incidentCountBySite.get(String(site._id)) || 0 }))
      });
    } catch (error) {
      console.error("PLATFORM SITES ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to list sites.", error: error.message });
    }
  });

  router.get("/incidents", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10) || 100, 1), 500);
      const skip = Math.max(Number.parseInt(req.query.skip || "0", 10) || 0, 0);
      const filter = {};
      if (req.query.realmId) filter.realmId = toObjectId(req.query.realmId);
      if (req.query.status && req.query.status !== "ALL") filter.status = req.query.status === "ACTIVE" ? { $ne: "RESOLVED" } : req.query.status;

      const [incidents, total] = await Promise.all([
        Incident.find(filter).select("incidentId device severity status source createdAt resolvedAt realmId").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Incident.countDocuments(filter)
      ]);
      const names = await realmNameMap(incidents.map(i => i.realmId).filter(Boolean));
      return res.json({ success: true, incidents: incidents.map(i => ({ ...i, realmName: names.get(String(i.realmId)) || null })), pagination: { total, limit, skip, returned: incidents.length, hasMore: skip + incidents.length < total } });
    } catch (error) {
      console.error("PLATFORM INCIDENTS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to list incidents.", error: error.message });
    }
  });

  // Cross-realm incident/escalation comparison - grouped in the database,
  // not downloaded and summed in JS (same performance requirement as
  // realmCounts above).
  router.get("/analytics", async (req, res) => {
    try {
      const days = Math.min(Math.max(Number.parseInt(req.query.days || "30", 10) || 30, 1), 90);
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);

      const [byRealmIncidents, bySeverity, byRealmEscalations, realms, sites, technicians] = await Promise.all([
        Incident.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$realmId", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
        Incident.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$severity", count: { $sum: 1 } } }]),
        Incident.aggregate([
          { $match: { createdAt: { $gte: since } } },
          { $project: { realmId: 1, status: 1, escalationLevel: 1, resolvedAt: 1, createdAt: 1, escalated: { $gt: ["$escalationLevel", 1] } } },
          { $group: { _id: "$realmId", triggered: { $sum: { $cond: ["$escalated", 1, 0] } }, resolved: { $sum: { $cond: [{ $eq: ["$status", "RESOLVED"] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } } } }
        ]),
        Realm.find({}).select("name").lean(),
        computePlatformSitePerformance({ windowDays: days }),
        computeTechnicianPerformance({})
      ]);

      const nameById = new Map(realms.map(r => [String(r._id), r.name]));
      return res.json({
        success: true,
        windowDays: days,
        incidentsByRealm: byRealmIncidents.map(row => ({ realmId: row._id, realmName: nameById.get(String(row._id)) || "Unknown", count: row.count })),
        severityBreakdown: Object.fromEntries(bySeverity.map(row => [row._id || "unknown", row.count])),
        escalationsByRealm: byRealmEscalations.map(row => ({ realmId: row._id, realmName: nameById.get(String(row._id)) || "Unknown", triggered: row.triggered, resolved: row.resolved, failed: row.failed })),
        sites,
        technicians
      });
    } catch (error) {
      console.error("PLATFORM ANALYTICS ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to compute platform analytics.", error: error.message });
    }
  });

  router.get("/audit", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10) || 100, 1), 500);
      const skip = Math.max(Number.parseInt(req.query.skip || "0", 10) || 0, 0);
      const filter = {};
      if (req.query.realmId) filter.realmId = toObjectId(req.query.realmId);
      if (req.query.action) filter.action = req.query.action;
      if (req.query.targetId) filter.targetId = req.query.targetId;
      if (req.query.actorTechnicianId) filter.actorTechnicianId = req.query.actorTechnicianId;

      const [entries, total] = await Promise.all([
        AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
        AuditLog.countDocuments(filter)
      ]);
      return res.json({ success: true, entries, pagination: { total, limit, skip, returned: entries.length, hasMore: skip + entries.length < total } });
    } catch (error) {
      console.error("PLATFORM AUDIT ERROR:", error);
      return res.status(500).json({ success: false, message: "Failed to list audit log.", error: error.message });
    }
  });

  return router;
}
