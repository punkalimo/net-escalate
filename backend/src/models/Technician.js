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

    phone: {
      type: String,
      required: true
    },

    level: {
      type: Number,
      required: true,
      min: 1
    },

    role: {
      type: String,
      default: "Network Technician"
    },

    active: {
      type: Boolean,
      default: true
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