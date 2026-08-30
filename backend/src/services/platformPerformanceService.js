// Cross-realm per-site performance rollup for the platform admin's Analytics
// page - the site-level counterpart to platformRoutes.js's escalationsByRealm.
// Incidents don't carry siteId directly (only deviceId), so getting a site's
// incident/escalation counts requires a $lookup join to Device on deviceId,
// unlike every other aggregation in this app so far.
import mongoose from "mongoose";
import Site from "../models/Site.js";
import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import Realm from "../models/Realm.js";

export async function computePlatformSitePerformance({ windowDays = 30 } = {}) {
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  const [sites, deviceRows, incidentRows, realms] = await Promise.all([
    Site.find({}).lean(),
    Device.aggregate([
      { $match: { siteId: { $ne: null } } },
      { $group: { _id: "$siteId", deviceCount: { $sum: 1 }, devicesDown: { $sum: { $cond: [{ $eq: ["$status", "DOWN"] }, 1, 0] } } } }
    ]),
    Incident.aggregate([
      { $match: { createdAt: { $gte: since }, deviceId: { $ne: null } } },
      { $lookup: { from: "devices", localField: "deviceId", foreignField: "deviceId", as: "device" } },
      { $unwind: "$device" },
      { $match: { "device.siteId": { $ne: null } } },
      { $group: { _id: "$device.siteId", incidents: { $sum: 1 }, escalated: { $sum: { $cond: [{ $gt: ["$escalationLevel", 1] }, 1, 0] } } } }
    ]),
    Realm.find({}).select("name").lean()
  ]);

  const deviceById = new Map(deviceRows.map(row => [String(row._id), row]));
  const incidentById = new Map(incidentRows.map(row => [String(row._id), row]));
  const realmNameById = new Map(realms.map(r => [String(r._id), r.name]));

  return sites.map(site => {
    const deviceStats = deviceById.get(String(site._id));
    const incidentStats = incidentById.get(String(site._id));
    return {
      siteId: String(site._id),
      name: site.name,
      realmId: String(site.realmId),
      realmName: realmNameById.get(String(site.realmId)) || "Unknown",
      deviceCount: deviceStats?.deviceCount || 0,
      devicesDown: deviceStats?.devicesDown || 0,
      incidents: incidentStats?.incidents || 0,
      escalated: incidentStats?.escalated || 0
    };
  });
}

export default { computePlatformSitePerformance };
