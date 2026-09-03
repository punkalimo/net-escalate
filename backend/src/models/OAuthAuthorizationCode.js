import mongoose from "mongoose";

// Short-lived, single-use authorization codes for the remote MCP OAuth
// bridge (oauthRoutes.js/oauthService.js) - see docs/WEBMCP.md's "Remote MCP
// + OAuth" section. Stored in Mongo (not in-memory) so a code issued right
// before a server restart/redeploy on Render still redeems correctly, and so
// a multi-instance deployment doesn't require sticky sessions.
//
// The realmId here is ALREADY RESOLVED at consent time (oauthRoutes.js's
// /oauth/authorize) - a normal technician's own realm, or a platform admin's
// explicit realm-picker choice - exactly like attachRealmScope.js never
// trusts a client-supplied realmId, this never trusts anything the OAuth
// client (ChatGPT) supplies either.
const oauthAuthorizationCodeSchema = new mongoose.Schema(
  {
    codeHash: {
      type: String,
      unique: true,
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

    redirectUri: {
      type: String,
      required: true
    },

    // PKCE (RFC 7636) - required by ChatGPT's connector setup. Only S256 is
    // accepted (see oauthService.js) - "plain" is not supported.
    codeChallenge: {
      type: String,
      required: true
    },

    scope: {
      type: String,
      default: "read"
    },

    used: {
      type: Boolean,
      default: false
    },

    // TTL index below deletes the document outright once expired - `used`
    // still guards against a double-redeem inside the 60s window itself.
    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true
  }
);

oauthAuthorizationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("OAuthAuthorizationCode", oauthAuthorizationCodeSchema);
