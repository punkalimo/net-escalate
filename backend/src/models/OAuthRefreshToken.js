import mongoose from "mongoose";

// Long-lived refresh tokens for the remote MCP OAuth bridge. Stored HASHED
// (bcrypt, same helper as Technician passwordHash - see authService.js's
// hashPassword) - never plaintext - so a database read alone never yields a
// usable token, matching how login credentials are already handled.
//
// realmId is fixed at the original /oauth/authorize consent and never
// changes for the lifetime of this token - if a technician's realm
// assignment changes, the connector must be re-authorized, not silently
// re-scoped.
const oauthRefreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true
    },

    technicianId: {
      type: String,
      required: true
    },

    realmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Realm",
      required: true
    },

    clientId: {
      type: String,
      required: true
    },

    scope: {
      type: String,
      default: "read"
    },

    // Set on /oauth/revoke or on rotation (a used refresh token is revoked,
    // not deleted, so a replay of an already-rotated token is detectable
    // rather than just silently 404ing).
    revoked: {
      type: Boolean,
      default: false
    },

    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true
  }
);

oauthRefreshTokenSchema.index({ technicianId: 1 });
oauthRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("OAuthRefreshToken", oauthRefreshTokenSchema);
