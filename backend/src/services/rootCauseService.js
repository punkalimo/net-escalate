// Computes a probable-root-cause explanation for an incident, on demand -
// same "derive from already-persisted Incident/Device data, don't add a new
// collection" pattern incidentCorrelationService.js uses for correlation
// groups. Deliberately pure/stateless so it's cheap to call per-request and
// easy to unit test.
//
// Confidence is capped below 100 and every description is qualified as
// "Probable"/"Possible" root cause - this system reasons from monitoring
// signals and timing, not proof, and must never claim certainty.

const SOURCE_BASE_CONFIDENCE = { DEVICE_MONITOR: 85, INTERFACE_HEALTH: 85, SYSTEM_HEALTH: 78, MANUAL: 45 };
const CONFIDENCE_CEILING = 97;
const PROBABLE_THRESHOLD = 75;

function describeFault(incident) {
  const text = `${incident.description || ""}`.toLowerCase();
  if (incident.source === "INTERFACE_HEALTH") {
    if (text.includes("flap")) return { kind: "Interface flapping", detail: "the interface is repeatedly transitioning up and down" };
    if (text.includes("error") || text.includes("discard")) return { kind: "Interface error-rate degradation", detail: "the interface is passing traffic but showing an elevated error/discard rate" };
    if (text.includes("utilization") || text.includes("congest")) return { kind: "Interface utilization degradation", detail: "the interface is congested" };
    return { kind: "Interface failure", detail: "the interface is administratively up but operationally down" };
  }
  if (incident.source === "SYSTEM_HEALTH") {
    if (text.includes("memory")) return { kind: "Device memory pressure", detail: "memory utilization crossed the configured threshold" };
    return { kind: "Device CPU pressure", detail: "CPU utilization crossed the configured threshold" };
  }
  if (incident.source === "DEVICE_MONITOR") return { kind: "Device reachability failure", detail: "the device stopped responding to monitoring probes" };
  return { kind: "Reported fault", detail: "no automatic monitoring signal is attached to this incident" };
}

// children: [{ hostname, interfaceName, createdAt }] - the incident's
// correlated downstream symptoms, if it is a correlation-group root. Pass
// an empty array for a standalone incident; the reasoning and wording
// degrade gracefully either way.
export function computeRootCause(incident, { device, children = [] } = {}) {
  const fault = describeFault(incident);
  const evidence = [];
  let confidence = SOURCE_BASE_CONFIDENCE[incident.source] ?? 50;

  if (device?.status === "DOWN" && incident.source !== "MANUAL") {
    confidence += 8;
    evidence.push(`${device.hostname} is currently reporting DOWN.`);
  }
  if (incident.interfaceName) evidence.push(`Fault is scoped to interface ${incident.interfaceName}.`);

  const deviceLabel = device?.hostname || incident.device;
  const interfaceSuffix = incident.interfaceName ? ` (${incident.interfaceName})` : "";

  let description;
  if (children.length) {
    const deltasSeconds = children
      .map(child => Math.round((new Date(child.createdAt).getTime() - new Date(incident.createdAt).getTime()) / 1000))
      .filter(Number.isFinite);
    const minDelta = deltasSeconds.length ? Math.max(0, Math.min(...deltasSeconds)) : null;
    const maxDelta = deltasSeconds.length ? Math.max(0, Math.max(...deltasSeconds)) : null;
    description = `${fault.kind} on ${deviceLabel}${interfaceSuffix} — ${fault.detail}${minDelta != null ? `, ${minDelta}s before the first downstream device became unreachable` : ""}.`;
    evidence.push(`${children.length} downstream incident(s) began within ${maxDelta ?? "a few"}s of this one.`);
    confidence += Math.min(children.length * 3, 12);
  } else {
    description = `${fault.kind} on ${deviceLabel}${interfaceSuffix} — ${fault.detail}.`;
  }

  if (!evidence.length) evidence.push("Based on the incident's own monitoring source; no corroborating signals available yet.");

  confidence = Math.max(0, Math.min(CONFIDENCE_CEILING, Math.round(confidence)));

  const affectedDevices = [deviceLabel, ...children.map(child => child.hostname).filter(Boolean)];
  const affectedInterfaces = [incident.interfaceName, ...children.map(child => child.interfaceName)].filter(Boolean);

  return {
    label: confidence >= PROBABLE_THRESHOLD ? "Probable root cause" : "Possible root cause",
    device: deviceLabel,
    interfaceName: incident.interfaceName || null,
    description,
    confidence,
    evidence,
    affectedDevices: [...new Set(affectedDevices)],
    affectedInterfaces: [...new Set(affectedInterfaces)],
    affectedDeviceCount: 1 + children.length
  };
}

export default { computeRootCause };
