// Shared helpers for the WebMCP agent-facing tool layer (webmcpRoutes.js).
//
// This module deliberately contains NO new business/intelligence logic -
// every fact a tool reports comes from an existing model or an existing
// service in backend/src/services/*. What lives here is only the stuff
// specific to exposing that data to an AI agent safely:
//
//   - sanitizers that strip fields a tool response must never contain
//     (SNMP credentials, password hashes, raw Mongo/JWT internals)
//   - a compact "tool-shaped" projection of each model (an agent gets a
//     summary, not a full Mongoose document)
//   - a structured error envelope (see docs/WEBMCP.md's error-handling
//     section) so a tool never leaks a stack trace or a raw Mongo error
//   - one audit-log entry per tool invocation, separate from (but using
//     the same auditLogService.js as) the app's existing privileged-action
//     audit trail

import { logAudit } from "./auditLogService.js";

// ---- Sanitizers -----------------------------------------------------------

// Device.snmp (community string, SNMPv3 username/authKey/privKey) is
// plaintext in MongoDB and has no schema-level redaction (unlike
// Technician.passwordHash) - every route that already exists sends it to
// the authenticated human dashboard because the human configured it and is
// allowed to see/edit it again. A WebMCP tool response is a different
// trust boundary (read by an LLM, potentially relayed further), so it must
// never include it, full stop.
export function sanitizeDevice(device) {
  if (!device) return null;
  return {
    deviceId: device.deviceId,
    hostname: device.hostname,
    ipAddress: device.ipAddress,
    deviceType: device.deviceType,
    vendor: device.vendor || null,
    model: device.model || null,
    role: device.role,
    location: device.location || null,
    siteId: device.siteId ? String(device.siteId) : null,
    status: device.status,
    monitoringEnabled: device.monitoringEnabled,
    monitoringMethods: device.monitoringMethods || [],
    lastSeenAt: device.lastSeenAt,
    lastPollAt: device.lastPollAt,
    lastStatusChangeAt: device.lastStatusChangeAt,
    activeIncidentId: device.activeIncidentId || null,
    lastError: device.lastError || null,
    interfaceCount: Array.isArray(device.interfaces) ? device.interfaces.length : 0,
    parentDeviceId: device.parentDeviceId || null
  };
}

export function sanitizeDeviceHealth(device) {
  if (!device) return null;
  return {
    deviceId: device.deviceId,
    hostname: device.hostname,
    ipAddress: device.ipAddress,
    status: device.status,
    monitoringEnabled: device.monitoringEnabled,
    lastSeenAt: device.lastSeenAt,
    lastPollAt: device.lastPollAt,
    lastStatusChangeAt: device.lastStatusChangeAt,
    lastError: device.lastError || null,
    ping: device.monitoringResult?.ping || null,
    cpu: device.systemHealth?.cpu ? { utilizationPercent: device.systemHealth.cpu.utilizationPercent, health: device.systemHealth.cpu.health, healthReasons: device.systemHealth.cpu.healthReasons, checkedAt: device.systemHealth.cpu.checkedAt } : null,
    memory: device.systemHealth?.memory ? { utilizationPercent: device.systemHealth.memory.utilizationPercent, health: device.systemHealth.memory.health, healthReasons: device.systemHealth.memory.healthReasons, checkedAt: device.systemHealth.memory.checkedAt } : null,
    activeIncidentId: device.activeIncidentId || null,
    healthSummary: summarizeDeviceHealth(device)
  };
}

function summarizeDeviceHealth(device) {
  if (!device.monitoringEnabled) return "Monitoring is disabled for this device.";
  if (device.status === "DOWN") return `Device is DOWN${device.lastError ? `: ${device.lastError}` : "."}`;
  if (device.status === "DEGRADED") return "Device is reachable but degraded (elevated CPU/memory or partial connectivity failure).";
  if (device.status === "UNKNOWN") return "Device has not completed a monitoring cycle yet.";
  return "Device is UP and reporting normally.";
}

export function sanitizeInterface(iface) {
  if (!iface) return null;
  return {
    ifIndex: iface.ifIndex,
    name: iface.name,
    description: iface.description || null,
    ipAddress: iface.ipAddress || null,
    status: iface.status,
    adminState: iface.adminState,
    monitored: iface.monitored,
    speedMbps: iface.metrics?.speedMbps ?? null,
    duplex: iface.metrics?.duplex || "UNKNOWN",
    utilizationPercent: iface.metrics?.utilizationPercent ?? null,
    inBps: iface.metrics?.inBps ?? null,
    outBps: iface.metrics?.outBps ?? null,
    inErrors: iface.metrics?.inErrors ?? 0,
    outErrors: iface.metrics?.outErrors ?? 0,
    inDiscards: iface.metrics?.inDiscards ?? 0,
    outDiscards: iface.metrics?.outDiscards ?? 0,
    errorRatePerMin: iface.metrics?.errorRatePerMin ?? null,
    discardRatePerMin: iface.metrics?.discardRatePerMin ?? null,
    health: iface.metrics?.health || "UNKNOWN",
    healthReasons: iface.metrics?.healthReasons || [],
    checkedAt: iface.metrics?.checkedAt || null
  };
}

// technician.lean() bypasses Technician's toJSON transform, so passwordHash
// must be stripped by hand here - see backend audit note in webmcpRoutes.js.
export function sanitizeTechnician(technician) {
  if (!technician) return null;
  return {
    technicianId: technician.technicianId,
    name: technician.name,
    phone: technician.phone || null,
    level: technician.level ?? null,
    role: technician.role || null,
    active: technician.active,
    realmRole: technician.realmRole || null,
    hasLogin: Boolean(technician.passwordHash)
  };
}

export function sanitizeIncidentSummary(incident) {
  if (!incident) return null;
  return {
    incidentId: incident.incidentId,
    device: incident.device,
    deviceId: incident.deviceId || null,
    location: incident.location,
    severity: incident.severity,
    status: incident.status,
    description: incident.description,
    source: incident.source,
    escalationLevel: incident.escalationLevel,
    technician: incident.technician?.id ? { id: incident.technician.id, name: incident.technician.name, role: incident.technician.role } : null,
    correlationRole: incident.correlationRole,
    correlationGroupId: incident.correlationGroupId || null,
    parentIncidentId: incident.parentIncidentId || null,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    resolvedAt: incident.resolvedAt || null
  };
}

export function sanitizeIncidentDetail(incident) {
  if (!incident) return null;
  return {
    ...sanitizeIncidentSummary(incident),
    acknowledgement: incident.acknowledgement || null,
    resolutionNotes: incident.resolutionNotes || null,
    severityReasons: incident.severityReasons || [],
    interfaceName: incident.interfaceName || null,
    correlationConfidence: incident.correlationConfidence ?? null,
    correlationEvidence: incident.correlationEvidence || [],
    impactedDevices: (incident.impactedDevices || []).map(d => ({ deviceId: d.deviceId, hostname: d.hostname, status: d.status })),
    timeline: (incident.timeline || []).map(event => ({ type: event.type, message: event.message, actor: event.actor, at: event.at })),
    remediationActions: (incident.remediationActions || []).map(a => ({ actionId: a.actionId, actionType: a.actionType, label: a.label, riskLevel: a.riskLevel, status: a.status }))
  };
}

// ---- Error envelope ---------------------------------------------------

// Every WebMCP route returns this exact shape on failure - never a raw
// error.message from Mongoose/Mongo, never a stack trace. `message` here
// is always a hand-written, safe-to-show-an-agent string; the underlying
// error (if any) is only ever console.error'd server-side.
export function toolError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// ---- Audit -----------------------------------------------------------

// One row per WebMCP tool invocation, layered on the app's existing
// AuditLog/auditLogService (see auditLogService.js) rather than a parallel
// table. classification is "read" or "write" (matches §9's read-only vs
// consequential split); approval is only meaningful for "write" tools and
// records what the frontend's human-confirmation gate reported (the
// backend's own authorization - requireAuth/attachRealmScope/role guards -
// is the actual security boundary either way; this is provenance, not a
// second gate).
export async function logToolInvocation(req, { tool, classification, targetType = null, targetId = null, approval = null, result = "success", metadata = null }) {
  await logAudit({
    actor: req.user,
    realmId: req.realmId,
    targetType: targetType || "WebMCPTool",
    targetId,
    action: `WEBMCP_TOOL_${String(tool).toUpperCase()}`,
    metadata: { tool, classification, approval, result, ...(metadata || {}) },
    req
  });
}

export default { sanitizeDevice, sanitizeDeviceHealth, sanitizeInterface, sanitizeTechnician, sanitizeIncidentSummary, sanitizeIncidentDetail, toolError, logToolInvocation };
