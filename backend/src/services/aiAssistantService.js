// Answers incident-scoped questions ("Why is NET-1234 critical?", "What
// changed before it?") by matching the question to a known intent and
// reading the answer from the SAME structured intelligence already built
// across Phases 2-10 (root cause, blast radius, severity reasons, SLA,
// change correlation, similar incidents, recommended actions) - never an
// external LLM call, never invented telemetry. "Do not make AI the
// foundation... build structured incident intelligence first" is the whole
// point: this module is a deterministic query layer over data that already
// exists, phrased as natural language.
//
// phase4Routes.js's pre-existing /assistant endpoint (general, not
// incident-scoped: "N critical incidents, start with X") stays as the
// fallback for questions that don't name or imply a specific incident.

import Incident from "../models/Incident.js";
import Device from "../models/Device.js";
import { computeRootCause } from "./rootCauseService.js";
import { mergeDownstream, computeBlastRadius } from "./blastRadiusService.js";
import { computeRecommendedActions } from "./recommendedActionsService.js";
import { findSimilarIncidents } from "./historicalMatchService.js";
import { findPossibleChangeCause } from "./changeCorrelationService.js";
import { computeSlaStatus } from "./escalationPolicyService.js";
import { incidentDeviceMatches } from "./incidentCorrelationService.js";
import { MAX_LEVEL } from "./incidentService.js";

const INCIDENT_ID_PATTERN = /\b((?:NET|INC)-\d+)\b/i;

export function extractIncidentId(question) {
  const match = String(question || "").match(INCIDENT_ID_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

const INTENTS = [
  { key: "why_critical", test: q => /why.*(critical|severity)|severity.*(why|reason)/.test(q) },
  { key: "what_affected", test: q => /what.*affect|devices? affected|blast radius|impact/.test(q) },
  { key: "root_cause", test: q => /root cause|probable cause|why did (it|this) happen/.test(q) },
  { key: "what_changed", test: q => /what changed|change.?related|config(uration)? change/.test(q) },
  { key: "seen_before", test: q => /seen (this|it) before|similar|happened before|recurring/.test(q) },
  { key: "check_first", test: q => /check first|what should i (check|do)|recommended action|troubleshoot/.test(q) },
  { key: "who_responsible", test: q => /who.*(responsible|assigned)|which engineer|assigned (team|engineer)/.test(q) },
  { key: "escalation_time", test: q => /how long.*escalat|escalat.*(when|time)|\bsla\b/.test(q) },
  { key: "summarize", test: q => /summar/.test(q) }
];

export function matchIntent(question) {
  const lower = String(question || "").toLowerCase();
  for (const intent of INTENTS) if (intent.test(lower)) return intent.key;
  return null;
}

async function loadIncidentContext(incident) {
  const devices = await Device.find({ realmId: incident.realmId }).lean();
  const deviceById = new Map(devices.map(d => [d.deviceId, d]));
  const device = devices.find(d => incidentDeviceMatches(incident, d)) || null;

  let childRefs = [];
  if (incident.correlationRole === "ROOT" && incident.correlationGroupId) {
    const childDocs = await Incident.find({ realmId: incident.realmId, correlationGroupId: incident.correlationGroupId, correlationRole: "CHILD" }).select("device interfaceName createdAt").lean();
    childRefs = childDocs.map(child => {
      const childDevice = devices.find(d => incidentDeviceMatches(child, d)) || null;
      return { deviceId: childDevice?.deviceId || null, hostname: childDevice?.hostname || child.device, interfaceName: child.interfaceName, createdAt: child.createdAt };
    });
  }
  const downstream = mergeDownstream(childRefs, incident.impactedDevices);
  const blastRadius = computeBlastRadius(incident, { rootDevice: device, downstream, deviceById });
  const rootCause = computeRootCause(incident, { device, children: childRefs });
  const recommendedActions = computeRecommendedActions(incident, { device, blastRadius });
  const [changeCorrelation, similarIncidents] = await Promise.all([
    findPossibleChangeCause(incident),
    findSimilarIncidents(incident)
  ]);
  const sla = computeSlaStatus(incident, { maxLevel: MAX_LEVEL });

  return { blastRadius, rootCause, recommendedActions, changeCorrelation, similarIncidents, sla };
}

export function answerForIntent(intentKey, incident, context) {
  const { blastRadius, rootCause, recommendedActions, changeCorrelation, similarIncidents, sla } = context;
  switch (intentKey) {
    case "why_critical":
      return { answer: `${incident.incidentId} is ${incident.severity} severity. ${(incident.severityReasons || []).join(" ") || "No severity reasoning recorded for this incident."}`, evidence: incident.severityReasons || [] };
    case "what_affected":
      return { answer: `${blastRadius.affectedDeviceCount} device(s) affected across ${blastRadius.sitesAffected.length} site(s)${blastRadius.affectedInterfaceCount ? `, including ${blastRadius.affectedInterfaceCount} interface(s)` : ""}.${blastRadius.downstreamDevices.length ? ` Downstream: ${blastRadius.downstreamDevices.map(d => d.hostname).join(", ")}.` : ""}`, evidence: blastRadius.downstreamDevices.map(d => d.hostname) };
    case "root_cause":
      return { answer: `${rootCause.label}: ${rootCause.description} (${rootCause.confidence}% confidence).`, evidence: rootCause.evidence };
    case "what_changed":
      return changeCorrelation
        ? { answer: `A configuration change on ${changeCorrelation.hostname} was detected ${changeCorrelation.timeDifferenceLabel} before this incident.`, evidence: changeCorrelation.changes }
        : { answer: "No configuration change was detected in the window before this incident.", evidence: [] };
    case "seen_before":
      return similarIncidents.length
        ? { answer: `Yes - ${similarIncidents[0].incidentId} is ${similarIncidents[0].similarity}% similar. Previous resolution: ${similarIncidents[0].previousResolution || "not recorded"}.`, evidence: similarIncidents.map(s => `${s.incidentId} (${s.similarity}%)`) }
        : { answer: "No similar previous incident was found.", evidence: [] };
    case "check_first":
      return { answer: `Probable cause: ${recommendedActions.probableCause}. First step: ${recommendedActions.actions[0] || "no specific action available"}.`, evidence: recommendedActions.actions };
    case "who_responsible":
      return incident.technician?.name
        ? { answer: `${incident.technician.name}${incident.technician.role ? ` (${incident.technician.role})` : ""} is currently responsible, at escalation level ${incident.escalationLevel}.`, evidence: [] }
        : { answer: "No technician is currently assigned to this incident.", evidence: [] };
    case "escalation_time":
      if (!sla) return { answer: incident.status === "RESOLVED" ? "This incident is resolved; no further escalation is scheduled." : "No further escalation is scheduled for this incident right now.", evidence: [] };
      return { answer: sla.overdue ? "This incident is past its SLA deadline - escalation is due imminently." : `${sla.minutesRemaining} minute(s) until escalation to level ${sla.nextLevel} (${sla.phase.toLowerCase()} SLA).`, evidence: [] };
    case "summarize":
    default:
      return { answer: `${incident.incidentId}: ${String(incident.severity || "unknown").toUpperCase()} - ${incident.description} Affected: ${blastRadius.affectedDeviceCount} device(s). Root cause: ${rootCause.description} Status: ${incident.status}, assigned to ${incident.technician?.name || "no one yet"}.`, evidence: [] };
  }
}

export async function answerIncidentQuestion(question, incidentId, realmId) {
  const incident = await Incident.findOne({ incidentId, realmId }).lean();
  if (!incident) return { success: false, message: `Incident ${incidentId} not found.` };

  const intentKey = matchIntent(question) || "summarize";
  const context = await loadIncidentContext(incident);
  const { answer, evidence } = answerForIntent(intentKey, incident, context);

  return { success: true, mode: "structured-query", incidentId, intent: intentKey, question, answer, evidence, generatedAt: new Date().toISOString() };
}

export default { answerIncidentQuestion, extractIncidentId, matchIntent, answerForIntent };
