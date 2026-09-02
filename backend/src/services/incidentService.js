import Technician from "../models/Technician.js";
import Incident from "../models/Incident.js";
import { escalateToTechnician } from "./escalationService.js";
import { buildTimelineEvent, pushTimelineEvent } from "./timelineService.js";
import { emitToRealm } from "./realtimeService.js";
import { postSystemMessage } from "./chatService.js";

export const MAX_LEVEL = 3;

// incidentId (e.g. NET-1234) is intentionally globally unique across every
// realm, not per-realm - unlike Device.ipAddress, there's no reason two
// tenants would ever need the same incident id, and a shared id namespace
// makes cross-referencing (support, logs) unambiguous.
export async function generateUniqueIncidentId() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const incidentId = `NET-${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await Incident.exists({ incidentId });
    if (!exists) return incidentId;
  }
  return `NET-${Date.now().toString().slice(-9)}`;
}

// Shared incident-creation path behind both the human "Create incident"
// modal (incidentRoutes.js's POST /) and the WebMCP create_incident tool
// (webmcpRoutes.js) - one place that generates the id, starts the
// escalation workflow, emits the realtime event and posts the critical-
// severity chat alert, so an agent-created incident behaves identically to
// a human-created one from here on. `technician` is optional here (the
// human UI always supplies one; an agent typically creates the incident
// first and assigns a technician as a separate, separately-approved step -
// see assign_incident) - the automatic escalation workflow below still
// finds a Level 1 technician on its own either way.
export async function createManualIncident({ realmId, device, location, severity, description, technician = null, source = "MANUAL", actorLabel = "NOC engineer" }, io) {
  let incident = null;
  for (let attempt = 0; attempt < 5 && !incident; attempt += 1) {
    try {
      incident = await Incident.create({
        incidentId: await generateUniqueIncidentId(),
        realmId,
        device,
        location,
        severity,
        description,
        ...(technician ? { technician } : {}),
        source,
        severityReasons: [source === "AGENT" ? "Created by an AI agent; approved by a human NOC engineer before creation." : "Manually set by a NOC engineer."],
        timeline: [buildTimelineEvent("INCIDENT_CREATED", source === "AGENT" ? "Incident created by an AI agent (human-approved)." : "Incident manually created.", { actor: actorLabel })]
      });
    } catch (error) {
      if (error?.code !== 11000 || attempt === 4) throw error;
    }
  }

  if (io) emitToRealm(realmId, "incident_created", incident);
  processIncident(incident, io).catch(error => console.error("Escalation workflow error:", error));
  if (incident.severity === "critical") {
    postSystemMessage(realmId, `🔴 Critical incident ${incident.incidentId} created: ${incident.device} - ${incident.description}`, { linkedIncidentId: incident.incidentId }).catch(() => {});
  }
  return incident;
}

function emitIncidentUpdate(io, incident) {
  if (io) emitToRealm(incident.realmId, "incident_updated", incident);
}

// realmId scoped: without it, an incident in one realm could get escalated
// to another realm's technician entirely - the calling code always has this
// available from incident.realmId, since every Incident now carries one.
async function getTechnicianForLevel(level, realmId) {
  return Technician.findOne({ realmId, level, active: true }).sort({ createdAt: 1 });
}

function addHistoryEntry(incident, technician, level) {
  incident.escalationHistory.push({
    level,
    technicianId: technician.technicianId,
    technicianName: technician.name,
    technicianPhone: technician.phone,
    technicianRole: technician.role,
    callId: null,
    provider: null,
    providerCode: null,
    providerStatus: null,
    retryable: false,
    status: "CALLING",
    response: null,
    startedAt: new Date(),
    completedAt: null
  });
  return incident.escalationHistory[incident.escalationHistory.length - 1];
}

export async function processIncident(incident, io) {
  try {
    let level = Number(incident.escalationLevel || 1);

    while (level <= MAX_LEVEL) {
      console.log("========================================");
      console.log(`Processing escalation level ${level}`);
      console.log(`Incident: ${incident.incidentId}`);
      console.log("========================================");

      const technician = await getTechnicianForLevel(level, incident.realmId);
      if (!technician) {
        level += 1;
        if (level <= MAX_LEVEL) {
          incident.escalationLevel = level;
          incident.status = "ESCALATING";
          pushTimelineEvent(incident, "ESCALATION_TRIGGERED", `No active technician at level ${level - 1}; escalating to level ${level}.`, { actor: "escalation engine" });
          await incident.save();
          emitIncidentUpdate(io, incident);
          continue;
        }
        incident.status = "FAILED";
        incident.escalationLevel = MAX_LEVEL;
        await incident.save();
        emitIncidentUpdate(io, incident);
        return incident;
      }

      incident.technician = {
        id: technician.technicianId,
        name: technician.name,
        phone: technician.phone,
        role: technician.role
      };
      incident.escalationLevel = level;
      incident.status = "CALLING";
      incident.callProvider = process.env.CALL_PROVIDER || "simulation";
      incident.callProviderCode = null;
      incident.callProviderMessage = null;
      incident.callProviderRetryable = false;
      pushTimelineEvent(incident, "NOTIFICATION_SENT", `Level ${level} notification sent to ${technician.name}.`, { actor: "escalation engine" });
      await incident.save();
      emitIncidentUpdate(io, incident);

      const history = addHistoryEntry(incident, technician, level);
      await incident.save();
      emitIncidentUpdate(io, incident);

      let callResult;
      try {
        callResult = await escalateToTechnician(incident);
      } catch (error) {
        const permanent = error?.retryable === false || ["call_not_ready", "unsupported_region", "unsupported_locale", "invalid_destination"].includes(error?.code);
        history.status = permanent ? "PROVIDER_UNAVAILABLE" : "FAILED";
        history.provider = incident.callProvider;
        history.providerCode = error?.code || "provider_error";
        history.providerStatus = error?.status || null;
        history.retryable = error?.retryable === true;
        history.response = error?.message || "Call provider failed.";
        history.completedAt = new Date();
        incident.callProviderCode = history.providerCode;
        incident.callProviderMessage = history.response;
        incident.callProviderRetryable = history.retryable;
        incident.status = "FAILED";
        await incident.save();
        emitIncidentUpdate(io, incident);

        // A permanent provider capability failure is not a technician failure.
        // Do not call the same unsupported destination at Levels 2/3.
        if (permanent) {
          console.warn(`CALL provider unavailable for ${incident.incidentId}; escalation stopped.`);
          return incident;
        }

        level += 1;
        if (level <= MAX_LEVEL) {
          incident.escalationLevel = level;
          incident.status = "ESCALATING";
          pushTimelineEvent(incident, "ESCALATION_TRIGGERED", `Call provider failed at level ${level - 1}; escalating to level ${level}.`, { actor: "escalation engine" });
          await incident.save();
          emitIncidentUpdate(io, incident);
          continue;
        }
        return incident;
      }

      incident.calleCallId = callResult?.id || null;
      history.callId = incident.calleCallId;
      history.provider = incident.callProvider;
      history.providerCode = callResult?.failureCode || null;
      history.providerStatus = null;

      const result = callResult?.structuredResult || {};
      const acknowledged = result.acknowledged === true && result.technician_available === true;
      const escalationRequired = result.escalation_required === true;

      if (acknowledged) {
        incident.status = "ACKNOWLEDGED";
        incident.acknowledgement = result.technician_response || "Technician acknowledged the incident.";
        history.status = "ACKNOWLEDGED";
        history.response = incident.acknowledgement;
        history.completedAt = new Date();
        pushTimelineEvent(incident, "INCIDENT_ACKNOWLEDGED", `${technician.name} acknowledged the incident.`, { actor: technician.name });
        await incident.save();
        emitIncidentUpdate(io, incident);
        console.log(`Incident ${incident.incidentId} acknowledged by ${technician.name}.`);
        return incident;
      }

      if (escalationRequired) {
        history.status = "ESCALATED";
        history.response = result.technician_response || "Technician unavailable. Escalation required.";
        history.completedAt = new Date();
        await incident.save();
        emitIncidentUpdate(io, incident);
        level += 1;
        if (level <= MAX_LEVEL) {
          incident.escalationLevel = level;
          incident.status = "ESCALATING";
          pushTimelineEvent(incident, "ESCALATION_TRIGGERED", `${technician.name} was unavailable at level ${level - 1}; escalating to level ${level}.`, { actor: "escalation engine" });
          await incident.save();
          emitIncidentUpdate(io, incident);
          continue;
        }
      } else {
        history.status = "FAILED";
        history.response = result.technician_response || "Call completed without a clear acknowledgement.";
        history.completedAt = new Date();
        await incident.save();
        emitIncidentUpdate(io, incident);
        level += 1;
        if (level <= MAX_LEVEL) {
          incident.escalationLevel = level;
          incident.status = "ESCALATING";
          pushTimelineEvent(incident, "ESCALATION_TRIGGERED", `No clear acknowledgement from ${technician.name} at level ${level - 1}; escalating to level ${level}.`, { actor: "escalation engine" });
          await incident.save();
          emitIncidentUpdate(io, incident);
          continue;
        }
      }

      incident.status = "FAILED";
      incident.escalationLevel = MAX_LEVEL;
      await incident.save();
      emitIncidentUpdate(io, incident);
      return incident;
    }

    incident.status = "FAILED";
    incident.escalationLevel = MAX_LEVEL;
    await incident.save();
    emitIncidentUpdate(io, incident);
    return incident;
  } catch (error) {
    console.error("INCIDENT PROCESSING ERROR:", error);
    incident.status = "FAILED";
    await incident.save();
    emitIncidentUpdate(io, incident);
    throw error;
  }
}
