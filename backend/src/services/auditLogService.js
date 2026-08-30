import AuditLog from "../models/AuditLog.js";

// actor: the req.user JWT payload (or null for unauthenticated events like a
// failed login). req: the Express request, used only to pull ip/user-agent -
// never awaited/blocking beyond the insert itself, and never throws into the
// caller's control flow (a failed audit write must not break the action it's
// auditing).
export async function logAudit({ actor, realmId, targetType, targetId, action, metadata, req }) {
  try {
    await AuditLog.create({
      actorTechnicianId: actor?.technicianId || null,
      actorName: actor?.name || null,
      actorRole: actor?.platformRole || actor?.realmRole || null,
      realmId: realmId ?? actor?.realmId ?? null,
      targetType,
      targetId: targetId != null ? String(targetId) : null,
      action,
      metadata: metadata || null,
      ip: req?.ip || null,
      userAgent: req?.get?.("user-agent") || null
    });
  } catch (error) {
    console.error("AUDIT LOG WRITE FAILED:", error.message);
  }
}

export default { logAudit };
