// Per-site performance rollup - device status breakdown plus the same
// incident/SLA/MTTA/MTTR aggregation dashboardService.js already computes
// for a whole realm, narrowed to just this site's devices. Not a new model
// of its own; reuses computeIncidentOverview's deviceIds filter rather than
// re-deriving incident aggregation a second time.

import Device from "../models/Device.js";
import { computeIncidentOverview } from "./dashboardService.js";

export async function computeSiteOverview({ realmId, siteId }) {
  const devices = await Device.find({ realmId, siteId }).select("deviceId hostname ipAddress status deviceType vendor model activeIncidentId").lean();
  const deviceIds = devices.map(device => device.deviceId);

  const statusCounts = { UP: 0, DOWN: 0, DEGRADED: 0, UNKNOWN: 0 };
  for (const device of devices) statusCounts[device.status] = (statusCounts[device.status] || 0) + 1;

  const overview = deviceIds.length
    ? await computeIncidentOverview({ realmId, deviceIds })
    : { activeIncidents: 0, criticalIncidents: 0, slaBreaches: 0, meanTimeToAcknowledgeMinutes: null, meanTimeToResolveMinutes: null, mttrWindowDays: 30, mttrSampleSize: 0 };

  return {
    deviceCount: devices.length,
    statusCounts,
    devices,
    overview
  };
}

export default { computeSiteOverview };
