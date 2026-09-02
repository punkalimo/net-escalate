// Wraps document.modelContext.registerTool() (the real WebMCP API - see
// docs/WEBMCP.md) with the two behaviors every tool in this app needs:
//
//   1. an entry in the Agent Activity feed (security.js) for every call,
//      success or failure
//   2. for a "consequential" tool, a hard block on human approval before
//      the wrapped `run()` - the actual backend call - is ever invoked
//
// Nothing here talks to the network directly; each tool file (deviceTools.js,
// incidentTools.js, ...) supplies a `run(args)` function that calls
// services/webmcpApi.js, and this module is only the WebMCP registration +
// approval + activity plumbing around it.
import { logToolStart, logToolResult, requestApproval } from "./security.js";

function toContent(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

// Every tool result that reaches the agent - success or failure - is JSON
// text. Nothing here is ever interpreted as markup/instructions on the way
// out, and (see incidentTools.js/deviceTools.js) nothing untrusted coming
// IN from a device/incident record is treated as anything but a plain
// string value in that JSON either. See docs/WEBMCP.md's prompt-injection
// section.
function normalizeError(error) {
  const apiError = error?.response?.data?.error;
  if (apiError?.code && apiError?.message) return apiError;
  if (error?.response?.status === 401) return { code: "AUTHENTICATION_REQUIRED", message: "Your NetEscalate session has expired. Sign in again in the dashboard tab, then retry." };
  return { code: "TOOL_FAILED", message: "The tool call failed unexpectedly. No changes were made." };
}

let activeSignal = null;

export function beginRegistration() {
  const controller = new AbortController();
  activeSignal = controller.signal;
  return controller;
}

// Read-only tool: safe to call with no human confirmation - see the
// read-only list in docs/WEBMCP.md. Still fully audited (backend
// auditLogService writes one row per call - see webmcpService.js's
// logToolInvocation) and still shows up in the Agent Activity feed so a
// human watching the dashboard can see what the agent is looking at.
export async function registerReadTool({ name, description, inputSchema, run, summarize }) {
  if (typeof document === "undefined" || !document.modelContext) {
    console.warn(`[webmcp] document.modelContext is unavailable; "${name}" was not registered.`);
    return;
  }
  await document.modelContext.registerTool(
    {
      name,
      description,
      inputSchema,
      execute: async args => {
        const entry = logToolStart({ tool: name, classification: "read", summary: summarize ? summarize(args) : `Ran ${name}` });
        try {
          const result = await run(args || {});
          logToolResult(entry.id, { status: "success", detail: result });
          return toContent(result);
        } catch (error) {
          const normalized = normalizeError(error);
          logToolResult(entry.id, { status: "error", summary: normalized.message });
          return toContent({ success: false, error: normalized });
        }
      }
    },
    { signal: activeSignal }
  );
}

// Consequential tool: create_incident, assign_incident, add_incident_note.
// execute() does NOT call `run()` until requestApproval() resolves with
// approved:true - see security.js's comment for why this is a real gate,
// not a UI suggestion. A rejection is returned to the agent as a normal
// (non-throwing) structured result, same shape as any other failure, so
// the agent can report back to the human rather than erroring out.
export async function registerActionTool({ name, description, inputSchema, run, summarize, approvalSummary }) {
  if (typeof document === "undefined" || !document.modelContext) {
    console.warn(`[webmcp] document.modelContext is unavailable; "${name}" was not registered.`);
    return;
  }
  await document.modelContext.registerTool(
    {
      name,
      description,
      inputSchema,
      execute: async args => {
        const decision = await requestApproval({
          tool: name,
          summary: approvalSummary ? approvalSummary(args || {}) : `Agent is requesting permission to run ${name}.`,
          detail: args || {}
        });
        if (!decision.approved) {
          return toContent({ success: false, error: { code: "APPROVAL_REJECTED", message: decision.reason || "The human operator rejected this action. No changes were made." } });
        }

        const entry = logToolStart({ tool: name, classification: "write", summary: summarize ? summarize(args) : `Running ${name}` });
        try {
          const result = await run(args || {});
          logToolResult(entry.id, { status: "success", detail: result });
          return toContent(result);
        } catch (error) {
          const normalized = normalizeError(error);
          logToolResult(entry.id, { status: "error", summary: normalized.message });
          return toContent({ success: false, error: normalized });
        }
      }
    },
    { signal: activeSignal }
  );
}

export default { beginRegistration, registerReadTool, registerActionTool };
