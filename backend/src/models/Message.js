import mongoose from "mongoose";

// Realm team chat + 1:1 DMs. A "team" message is realm-wide (recipientId/
// dmKey are null); a "dm" message is private between exactly two
// technicians - dmKey is the two technicianIds sorted and joined with ":"
// so either participant's query finds the same conversation regardless of
// who sent which message, without needing two separate documents or an
// $or query on every read.
const attachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    // The on-disk filename under backend/uploads/<realmId>/ - deliberately
    // NOT derived from the original filename, to avoid any path-traversal
    // or collision risk. The original name is kept only in `filename` above
    // for display/Content-Disposition on download.
    storedName: { type: String, required: true },
    kind: { type: String, enum: ["image", "file"], required: true }
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", required: true, index: true },
    channel: { type: String, enum: ["team", "dm"], required: true },
    dmKey: { type: String, default: null },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    recipientId: { type: String, default: null },
    text: { type: String, default: "" },
    attachment: { type: attachmentSchema, default: null },
    // True for the two incident-aware auto-posts (new CRITICAL incident,
    // escalation triggered) - styled distinctly client-side, never sent by
    // a technician directly.
    systemGenerated: { type: Boolean, default: false },
    linkedIncidentId: { type: String, default: null }
  },
  { timestamps: true }
);

messageSchema.index({ realmId: 1, channel: 1, createdAt: -1 });
messageSchema.index({ realmId: 1, dmKey: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
