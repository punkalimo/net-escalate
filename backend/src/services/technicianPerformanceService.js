// Holistic per-technician performance rollup for realm managers - built
// entirely from data already recorded elsewhere (escalation call outcomes,
// currently-assigned incidents), no new tracking needed. Distinct from
// calleService.js's getCallCapability(), which only checks whether CALL-E
// can dial a number at all, not how well the technician performs.
import mongoose from "mongoose";
import Technician from "../models/Technician.js";
import Incident from "../models/Incident.js";
import Realm from "../models/Realm.js";

// realmId omitted/null means "every realm" - used by the platform admin's
// cross-realm analytics (technicianId is already globally unique, so there's
// no ambiguity grouping across realms without a realmId filter).
export async function computeTechnicianPerformance({ realmId = null } = {}) {
  // Incident.aggregate() bypasses Mongoose's query-casting (unlike
  // find()/countDocuments()), so realmId - a string off the JWT - must be
  // cast to ObjectId explicitly here, or these $match stages silently match
  // nothing (the exact bug this session already hit once in siteRoutes.js).
  const realmObjectId = realmId ? new mongoose.Types.ObjectId(realmId) : null;
  const realmFilter = realmId ? { realmId: realmObjectId } : {};
  const technicianFilter = realmId ? { realmId } : {};

  const [technicians, callRows, resolvedRows, activeRows, realms] = await Promise.all([
    Technician.find(technicianFilter).select("technicianId name role level realmId realmRole active").sort({ level: 1, name: 1 }).lean(),
    Incident.aggregate([
      { $match: { ...realmFilter, "escalationHistory.0": { $exists: true } } },
      { $unwind: "$escalationHistory" },
      { $match: { "escalationHistory.technicianId": { $ne: null } } },
      { $group: {
          _id: "$escalationHistory.technicianId",
          callsReceived: { $sum: 1 },
          acknowledged: { $sum: { $cond: [{ $eq: ["$escalationHistory.status", "ACKNOWLEDGED"] }, 1, 0] } },
          declined: { $sum: { $cond: [{ $eq: ["$escalationHistory.status", "DECLINED"] }, 1, 0] } },
          noAnswer: { $sum: { $cond: [{ $eq: ["$escalationHistory.status", "NO_ANSWER"] }, 1, 0] } },
          escalatedAway: { $sum: { $cond: [{ $eq: ["$escalationHistory.status", "ESCALATED"] }, 1, 0] } },
          ackSecondsTotal: { $sum: { $cond: [
            { $and: [{ $eq: ["$escalationHistory.status", "ACKNOWLEDGED"] }, { $ne: ["$escalationHistory.completedAt", null] }] },
            { $divide: [{ $subtract: ["$escalationHistory.completedAt", "$escalationHistory.startedAt"] }, 1000] },
            0
          ] } },
          ackWithTimingCount: { $sum: { $cond: [
            { $and: [{ $eq: ["$escalationHistory.status", "ACKNOWLEDGED"] }, { $ne: ["$escalationHistory.completedAt", null] }] },
            1, 0
          ] } }
        } }
    ]),
    Incident.aggregate([
      { $match: { ...realmFilter, "technician.id": { $ne: null }, status: "RESOLVED" } },
      { $group: { _id: "$technician.id", resolvedCount: { $sum: 1 } } }
    ]),
    Incident.aggregate([
      { $match: { ...realmFilter, "technician.id": { $ne: null }, status: { $ne: "RESOLVED" } } },
      { $group: { _id: "$technician.id", activeCount: { $sum: 1 } } }
    ]),
    realmId ? Promise.resolve([]) : Realm.find({}).select("name").lean()
  ]);

  const callsById = new Map(callRows.map(row => [row._id, row]));
  const resolvedById = new Map(resolvedRows.map(row => [row._id, row.resolvedCount]));
  const activeById = new Map(activeRows.map(row => [row._id, row.activeCount]));
  const realmNameById = new Map(realms.map(r => [String(r._id), r.name]));

  return technicians.map(tech => {
    const calls = callsById.get(tech.technicianId);
    const meanTimeToAcknowledgeMinutes = calls?.ackWithTimingCount ? Math.round((calls.ackSecondsTotal / calls.ackWithTimingCount / 60) * 10) / 10 : null;
    const acknowledgeRate = calls?.callsReceived ? Math.round((calls.acknowledged / calls.callsReceived) * 1000) / 10 : null;
    return {
      technicianId: tech.technicianId,
      name: tech.name,
      role: tech.role,
      level: tech.level,
      realmRole: tech.realmRole,
      active: tech.active,
      ...(realmId ? {} : { realmId: tech.realmId ? String(tech.realmId) : null, realmName: tech.realmId ? realmNameById.get(String(tech.realmId)) || "Unknown" : null }),
      callsReceived: calls?.callsReceived || 0,
      acknowledged: calls?.acknowledged || 0,
      declined: calls?.declined || 0,
      noAnswer: calls?.noAnswer || 0,
      escalatedAway: calls?.escalatedAway || 0,
      acknowledgeRate,
      meanTimeToAcknowledgeMinutes,
      resolvedIncidents: resolvedById.get(tech.technicianId) || 0,
      activeIncidents: activeById.get(tech.technicianId) || 0
    };
  });
}

export default { computeTechnicianPerformance };
