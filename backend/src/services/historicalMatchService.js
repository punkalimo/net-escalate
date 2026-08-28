// Finds resolved incidents similar to a given one - same device, interface,
// alert type, probable root cause (reusing rootCauseService.js's fault
// classification), site, or symptom text - and surfaces their resolution so
// an engineer can reuse a fix that already worked. Computed on demand, no
// new model: similarity is a pure function over fields Incident already has,
// and "previous resolution" reads the resolutionNotes field a NOC engineer
// optionally fills in when manually resolving an incident.

import Incident from "../models/Incident.js";
import { describeFault } from "./rootCauseService.js";

const STOPWORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "was", "were", "has", "have", "detected", "incident", "device", "interface"]);

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOPWORDS.has(word))
  );
}

export function textSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

export function scoreSimilarity(incident, candidate) {
  let score = 0;
  const evidence = [];

  if (incident.deviceId && incident.deviceId === candidate.deviceId) { score += 30; evidence.push("Same device."); }
  else if (incident.device === candidate.device) { score += 25; evidence.push("Same device label."); }

  if (incident.interfaceName && incident.interfaceName === candidate.interfaceName) { score += 20; evidence.push(`Same interface (${incident.interfaceName}).`); }

  if (incident.source === candidate.source) { score += 15; evidence.push("Same alert type."); }

  const currentFault = describeFault(incident).kind;
  const candidateFault = describeFault(candidate).kind;
  if (currentFault === candidateFault) { score += 20; evidence.push(`Same probable root cause category (${currentFault}).`); }

  if (incident.location && incident.location === candidate.location) { score += 10; evidence.push("Same site."); }

  const similarity = textSimilarity(incident.description, candidate.description);
  if (similarity > 0.15) { score += Math.round(similarity * 15); evidence.push("Similar symptom description."); }

  return { score: Math.min(100, score), evidence };
}

export async function findSimilarIncidents(incident, { limit = 3, minScore = 40, candidateWindow = 200 } = {}) {
  const orConditions = [{ source: incident.source }];
  if (incident.deviceId) orConditions.push({ deviceId: incident.deviceId });
  else if (incident.device) orConditions.push({ device: incident.device });
  if (incident.location) orConditions.push({ location: incident.location });

  const candidates = await Incident.find({ status: "RESOLVED", incidentId: { $ne: incident.incidentId }, $or: orConditions })
    .sort({ resolvedAt: -1 })
    .limit(candidateWindow)
    .lean();

  return candidates
    .map(candidate => ({ candidate, ...scoreSimilarity(incident, candidate) }))
    .filter(match => match.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate, score, evidence }) => ({
      incidentId: candidate.incidentId,
      device: candidate.device,
      description: candidate.description,
      previousRootCause: describeFault(candidate).kind,
      previousResolution: candidate.resolutionNotes || null,
      resolvedAt: candidate.resolvedAt,
      similarity: score,
      evidence
    }));
}

export default { textSimilarity, scoreSimilarity, findSimilarIncidents };
