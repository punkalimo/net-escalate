import mongoose from "mongoose";

const technicianSchema = new mongoose.Schema(
  {
    technicianId: {
      type: String,
      unique: true,
      required: true
    },

    name: {
      type: String,
      required: true
    },

    // Not required for a platform admin (platformRole set) - they aren't
    // part of any realm's escalation chain and never receive an escalation
    // call, so phone/level have nothing to mean for them.
    phone: {
      type: String,
      required: function () { return !this.platformRole; }
    },

    level: {
      type: Number,
      min: 1,
      required: function () { return !this.platformRole; }
    },

    role: {
      type: String,
      default: "Network Technician"
    },

    active: {
      type: Boolean,
      default: true
    },

    // Every normal (non-platform) technician belongs to exactly one Realm -
    // enforced at the route/service layer (create/registration always sets
    // it), not as a hard schema requirement, because a platform admin
    // deliberately has realmId: null (see platformRole below and the spec's
    // own "platform_super_admin, realm_id = NULL" representation).
    realmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Realm",
      default: null
    },

    // Authorization role WITHIN a realm - independent of `level`, which is
    // escalation-tier routing (getTechnicianForLevel, escalationSweepService.js)
    // and must never be conflated with authorization.
    realmRole: {
      type: String,
      enum: ["realm_owner", "realm_admin", "noc_manager", "senior_engineer", "technician", "viewer"],
      default: "technician"
    },

    // Set only for a platform-level operator (not tied to any single realm).
    // null for every normal realm technician.
    platformRole: {
      type: String,
      enum: ["platform_super_admin", "platform_support", "platform_analyst"],
      default: null
    },

    // Login credentials are optional and separate from the escalation
    // contact fields above: a technician can exist purely as a call target
    // (no username/passwordHash) without ever being able to log in to the
    // dashboard. Only granted/reset via the create-admin script or a Level 3
    // technician's "Manage login" action in the Escalation Team panel
    // (technicianRoutes.js's /credentials route) - never through open
    // self-registration.
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      default: null
    },

    passwordHash: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

technicianSchema.index({ realmId: 1 });
technicianSchema.index({ realmId: 1, level: 1, active: 1 });

// passwordHash must never reach the client - every route in this app sends
// full Technician documents (never .lean()), so a schema-level transform
// here is the one place that guarantees it, rather than relying on every
// route to remember to strip it. hasLogin lets the UI show whether login
// access is already granted without ever exposing the hash itself.
technicianSchema.set("toJSON", {
  transform(doc, ret) {
    ret.hasLogin = !!ret.passwordHash;
    delete ret.passwordHash;
    return ret;
  }
});

export default mongoose.model(
  "Technician",
  technicianSchema
);