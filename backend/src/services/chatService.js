// Incident-aware system messages posted to the realm's team channel - the
// two "differentiator" auto-posts (new CRITICAL incident, escalation
// triggered). Never sent by a technician; systemGenerated:true lets the
// frontend style these distinctly from a real message.
import Message from "../models/Message.js";
import { emitToRealm } from "./realtimeService.js";

export async function postSystemMessage(realmId, text, { linkedIncidentId = null } = {}) {
  if (!realmId) return null;
  try {
    const message = await Message.create({ realmId, channel: "team", senderId: "system", senderName: "NetEscalate", text, systemGenerated: true, linkedIncidentId });
    emitToRealm(realmId, "chat_message", message);
    return message;
  } catch (error) {
    // A failed system post should never break the incident-lifecycle code
    // path that triggered it - log and move on, same principle as
    // auditLogService.js's logAudit never throwing.
    console.error("POST SYSTEM MESSAGE ERROR:", error);
    return null;
  }
}

export default { postSystemMessage };
