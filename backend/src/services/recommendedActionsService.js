// Contextual troubleshooting steps for an incident, on demand - reuses
// rootCauseService.js's fault classification (the same "Interface failure" /
// "Device CPU pressure" / etc. kind already computed for the root-cause
// explanation) instead of re-deriving it, and keyed by that same kind so the
// two stay in lockstep. Computed at read time, not persisted - same pattern
// as rootCauseService.js/blastRadiusService.js.
//
// "Recommendations must be contextual... do not present generic
// troubleshooting instructions when better information is available": every
// list below is interpolated with the incident's actual device/interface,
// and the WAN-style ISP escalation steps only appear when the root device's
// own role (core/edge) makes an ISP hand-off plausible - an access switch or
// host never gets told to "check ISP circuit status."

import { describeFault } from "./rootCauseService.js";

const ISP_ESCALATION_ROLES = new Set(["core", "edge"]);

function interfaceActionCatalog(interfaceLabel) {
  return {
    "Interface failure": [
      "Check physical link/optic.",
      "Check interface administrative status.",
      "Check interface errors.",
      "Check remote interface.",
      "Verify upstream connectivity."
    ],
    "Interface flapping": [
      `Check physical link/optic on ${interfaceLabel} for a loose or failing connection.`,
      "Review recent cabling or hardware changes.",
      "Check for a duplex/speed mismatch with the connected device.",
      "Inspect interface error/discard counters for a correlated pattern.",
      "If flapping continues, consider disabling the port pending physical inspection."
    ],
    "Interface error-rate degradation": [
      `Check physical link/optic on ${interfaceLabel} for damage or a loose connection.`,
      "Check for a duplex mismatch with the connected device.",
      "Inspect cabling length/quality - rising CRC errors often indicate a cabling issue.",
      "Compare error counters against the remote end, if reachable.",
      "Consider scheduling cable/optic replacement if errors persist."
    ],
    "Interface utilization degradation": [
      `Identify the top talkers currently using ${interfaceLabel}.`,
      "Check for a sudden traffic pattern change (backup job, DoS, misconfigured QoS).",
      "Verify the link is running at its expected negotiated speed.",
      "Consider a capacity upgrade if utilization is consistently high."
    ]
  };
}

function deviceActionCatalog(hostname) {
  return {
    "Device memory pressure": [
      `Check for a process consuming excessive memory on ${hostname}.`,
      "Review recent configuration changes that could have introduced a memory leak.",
      "Check the free-memory trend over time, not just the current reading.",
      "Consider a scheduled reload if memory continues to climb with no identified cause."
    ],
    "Device CPU pressure": [
      `Identify the top CPU-consuming process on ${hostname}.`,
      "Check for a routing loop, broadcast storm, or unexpected traffic spike.",
      "Review recent configuration changes (ACLs, routing policy) that could increase CPU load.",
      "Consider load-shedding or failover if CPU remains critical."
    ],
    "Device reachability failure": [
      `Check physical connectivity to ${hostname}.`,
      "Verify the device's power status.",
      "Check the upstream device/interface for a related fault.",
      "Attempt an out-of-band (console) connection if available.",
      "Escalate to on-site/field support if the device remains unreachable."
    ],
    "Reported fault": [
      "Gather details on the reported symptom directly from the reporter.",
      `Check ${hostname}'s current device/interface status for supporting evidence.`,
      `Review recent incidents on ${hostname} for a related pattern.`
    ]
  };
}

// blastRadius: the already-computed result of blastRadiusService.computeBlastRadius,
// if available - used only to add a "N devices depend on this" priority note
// when there's genuinely something downstream to say it about.
export function computeRecommendedActions(incident, { device, blastRadius } = {}) {
  const fault = describeFault(incident);
  const hostname = device?.hostname || incident.device;
  const interfaceLabel = incident.interfaceName ? `${incident.interfaceName} on ${hostname}` : hostname;

  const catalog = { ...interfaceActionCatalog(interfaceLabel), ...deviceActionCatalog(hostname) };
  let actions = catalog[fault.kind]
    ? [...catalog[fault.kind]]
    : [`Check ${hostname}'s current status directly.`, "Review the incident description and any attached evidence.", "Escalate to a network engineer if the cause is not apparent."];

  if (fault.kind === "Interface failure" && ISP_ESCALATION_ROLES.has(device?.role)) {
    actions = [...actions, "Check ISP circuit status.", "Escalate to ISP if required."];
  }

  const contextNotes = [];
  if (blastRadius?.affectedDeviceCount > 1) {
    contextNotes.push(`${blastRadius.affectedDeviceCount - 1} downstream device(s) depend on this - prioritize restoring ${hostname} first.`);
  }

  return { probableCause: fault.kind, actions, contextNotes };
}

export default { computeRecommendedActions };
