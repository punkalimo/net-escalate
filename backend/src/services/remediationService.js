// Phase 13 - Controlled network remediation: a small, curated catalog of
// remediation actions keyed by the same fault classification
// recommendedActionsService.js already computes (describeFault), plus a
// simulated execution engine that mirrors escalationService.js's
// provider/scenario pattern. Nothing here ever touches a real device - every
// action is proposed, then explicitly approved, then explicitly run, and
// only "runs" as a timed simulation. Real SNMP-SET/SSH execution is a
// deliberately separate, future step (see README roadmap item 9).

import { describeFault } from "./rootCauseService.js";

const REMEDIATION_SCENARIO = process.env.REMEDIATION_SCENARIO || "success"; // "success" | "fail"
const REMEDIATION_DELAY_MS = Number(process.env.REMEDIATION_DELAY_MS || 2500);

const CATALOG_BY_FAULT_KIND = {
  "Interface failure": [
    { actionType: "FLAP_INTERFACE", label: "Flap interface (shutdown / no shutdown)", description: "Administratively disables and re-enables the interface to clear a stuck link state.", riskLevel: "medium" },
    { actionType: "INTERFACE_ADMIN_UP", label: "Bring interface administratively up", description: "Issues a no-shutdown if the interface is currently admin-down.", riskLevel: "low" }
  ],
  "Interface flapping": [
    { actionType: "CLEAR_INTERFACE_COUNTERS", label: "Clear interface error counters", description: "Resets interface counters so future flap detection starts from a clean baseline.", riskLevel: "low" }
  ],
  "Interface error-rate degradation": [
    { actionType: "CLEAR_INTERFACE_COUNTERS", label: "Clear interface error counters", description: "Resets interface counters after a suspected transient error burst.", riskLevel: "low" }
  ],
  "Interface utilization degradation": [
    { actionType: "CLEAR_INTERFACE_COUNTERS", label: "Clear interface traffic counters", description: "Resets counters to re-baseline utilization after investigating top talkers.", riskLevel: "low" }
  ],
  "Device CPU pressure": [
    { actionType: "RESTART_MONITORING_SESSION", label: "Restart device polling session", description: "Re-establishes SNMP polling in case a stuck session is amplifying load, without rebooting the device.", riskLevel: "low" }
  ],
  "Device memory pressure": [
    { actionType: "RESTART_MONITORING_SESSION", label: "Restart device polling session", description: "Re-establishes SNMP polling in case a stuck session is amplifying load, without rebooting the device.", riskLevel: "low" }
  ],
  "Device reachability failure": [
    { actionType: "REBOOT_DEVICE", label: "Reboot device", description: "A full device reboot - disruptive, only for a confirmed unreachable device with no other recovery path.", riskLevel: "high" }
  ]
};

const RESULT_MESSAGES = {
  FLAP_INTERFACE: { success: "Simulated: shutdown/no shutdown issued. Interface reported operationally up.", fail: "Simulated: no shutdown issued but the interface did not come back up - the underlying fault is likely still present." },
  INTERFACE_ADMIN_UP: { success: "Simulated: no shutdown issued. Interface administrative status is now up.", fail: "Simulated: no shutdown issued but the interface remained administratively down." },
  CLEAR_INTERFACE_COUNTERS: { success: "Simulated: interface counters cleared.", fail: "Simulated: counter-clear command timed out." },
  RESTART_MONITORING_SESSION: { success: "Simulated: polling session re-established.", fail: "Simulated: polling session restart failed - device did not respond." },
  REBOOT_DEVICE: { success: "Simulated: reboot command issued and the device came back reachable.", fail: "Simulated: reboot command issued but the device did not come back online." }
};

// device/hostname context only shapes the label shown to the operator -
// same "contextual, not generic" approach as recommendedActionsService.js.
export function computeRemediationCatalog(incident, { device } = {}) {
  const fault = describeFault(incident);
  const hostname = device?.hostname || incident.device;
  const target = incident.interfaceName ? `${incident.interfaceName} on ${hostname}` : hostname;
  const actions = (CATALOG_BY_FAULT_KIND[fault.kind] || []).map(action => ({ ...action, target }));
  return { probableCause: fault.kind, actions };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function simulateRemediation(actionType) {
  await wait(REMEDIATION_DELAY_MS);
  const succeeded = REMEDIATION_SCENARIO !== "fail";
  const messages = RESULT_MESSAGES[actionType] || { success: "Simulated action completed.", fail: "Simulated action failed." };
  return { succeeded, message: succeeded ? messages.success : messages.fail };
}

export default { computeRemediationCatalog, simulateRemediation };
