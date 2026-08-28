import Technician from "../models/Technician.js";
import { escalateToTechnician } from "./escalationService.js";
import { pushTimelineEvent } from "./timelineService.js";

export const MAX_LEVEL = 3;

function emitIncidentUpdate(io, incident) {
  if (io) io.emit("incident_updated", incident);
}

async function getTechnicianForLevel(level) {
  return Technician.findOne({ level, active: true }).sort({ createdAt: 1 });
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

      const technician = await getTechnicianForLevel(level);
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
