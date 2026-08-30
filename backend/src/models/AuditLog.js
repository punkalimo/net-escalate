import mongoose from "mongoose";

// Centralized audit trail for privileged actions - login/logout, realm
// lifecycle, technician/credential changes, Enter/Exit Realm. Not every
// mutation in the app is hooked (that would mean touching every route); see
// auditLogService.js for the specific, curated set of actions that write
// here. realmId is null for platform-level actions (e.g. a platform admin
// creating a realm, before any realm context exists).
const auditLogSchema = new mongoose.Schema(
  {
    actorTechnicianId: { type: String, default: null },
    actorName: { type: String, default: null },
    actorRole: { type: String, default: null },
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", default: null },
    targetType: { type: String, required: true },
    targetId: { type: String, default: null },
    action: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    at: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

auditLogSchema.index({ realmId: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
