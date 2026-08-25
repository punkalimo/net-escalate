import axios from "axios";

const CALLE_BASE_URL = process.env.CALLE_BASE_URL || "https://api.heycall-e.com";
const CALLE_API_KEY = process.env.CALLE_API_KEY || "";
const CALLE_REGION = process.env.CALLE_REGION || "ZM";
const CALLE_LOCALE = process.env.CALLE_LOCALE || "en-ZM";
const CALLE_POLL_INTERVAL_MS = Number(process.env.CALLE_POLL_INTERVAL_MS || 5000);
const CALLE_MAX_WAIT_MS = Number(process.env.CALLE_MAX_WAIT_MS || 180000);

// CALL-E currently does not advertise Zambia English support. Keep this
// explicit and conservative until the provider enables the route. This is
// deliberately not a region spoof: the actual destination remains +260/ZM.
const CALLE_UNSUPPORTED = new Set(
  String(process.env.CALLE_UNSUPPORTED_COMBINATIONS || "ZM:en-ZM")
    .split(",")
    .map(value => value.trim().toUpperCase())
    .filter(Boolean)
);

export class CalleProviderError extends Error {
  constructor(message, { code = "provider_error", status = null, retryable = false, details = null } = {}) {
    super(message);
    this.name = "CalleProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function validateConfiguration() {
  if (!CALLE_API_KEY) throw new CalleProviderError("CALLE_API_KEY is not configured.", { code: "configuration_error" });
}

function headers(idempotencyKey) {
  return {
    Authorization: `Bearer ${CALLE_API_KEY}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
  };
}

function normalizeCallResponse(data) {
  const structuredResult = data?.structured_result || data?.structuredResult || {};
  return {
    id: data?.id || data?.call_id || data?.callId || null,
    status: data?.status || null,
    taskCompleted: data?.task_completed === true || data?.taskCompleted === true,
    completionConfidence: data?.completion_confidence || data?.completionConfidence || null,
    evidence: data?.evidence || [],
    structuredResult: {
      acknowledged: structuredResult?.acknowledged === true,
      technician_available: structuredResult?.technician_available === true,
      escalation_required: structuredResult?.escalation_required === true,
      technician_response: structuredResult?.technician_response || structuredResult?.response || data?.summary || data?.transcript || null
    },
    failureCode: data?.failure_code || data?.failureCode || null,
    summary: data?.summary || null,
    raw: data
  };
}

function isTerminal(status) {
  return ["completed", "failed", "cancelled", "canceled", "expired"].includes(String(status || "").toLowerCase());
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function regionFromPhone(phone) {
  const normalized = String(phone || "").replace(/[\s()-]/g, "");
  if (normalized.startsWith("+260") || normalized.startsWith("00260")) return "ZM";
  return null;
}

export function getCallCapability(phone, region = CALLE_REGION, locale = CALLE_LOCALE) {
  const detectedRegion = region || regionFromPhone(phone);
  const key = `${String(detectedRegion || "").toUpperCase()}:${String(locale || "").toUpperCase()}`;
  if (CALLE_UNSUPPORTED.has(key)) {
    return {
      provider: "calle",
      supported: false,
      state: "UNSUPPORTED",
      region: detectedRegion,
      locale,
      code: "call_not_ready",
      message: `CALL-E does not currently support ${detectedRegion} with ${locale}. The destination will not be dispatched.`
    };
  }
  return {
    provider: "calle",
    supported: null,
    state: "UNKNOWN",
    region: detectedRegion,
    locale,
    code: null,
    message: "CALL-E capability is not locally known; the provider will perform the authoritative check."
  };
}

function parseProviderError(error) {
  const body = error?.response?.data;
  const payload = body?.error && typeof body.error === "object" ? body.error : body;
  return {
    status: error?.response?.status || null,
    code: payload?.code || null,
    message: payload?.message || body?.message || error?.message || "CALL-E request failed.",
    details: payload?.details || null
  };
}

const resultSchema = {
  type: "object",
  required: ["acknowledged", "technician_available", "escalation_required", "technician_response"],
  properties: {
    acknowledged: { type: "boolean" },
    technician_available: { type: "boolean" },
    escalation_required: { type: "boolean" },
    technician_response: { type: "string" }
  }
};

export async function callTechnician(incident) {
  if (!incident) throw new Error("Incident is required.");
  const technician = incident.technician;
  if (!technician) throw new Error("Incident does not have an assigned technician.");
  if (!technician.phone) throw new Error("Technician does not have a phone number.");
  validateConfiguration();

  const capability = getCallCapability(technician.phone, CALLE_REGION, CALLE_LOCALE);
  if (capability.state === "UNSUPPORTED") {
    throw new CalleProviderError(capability.message, {
      code: capability.code,
      status: 422,
      retryable: false,
      details: capability
    });
  }

  const level = Number(incident.escalationLevel || 1);
  const idempotencyKey = `netescalate:${incident.incidentId}:level:${level}`;
  const task = [
    `Call ${technician.phone}.`,
    "You are the automated incident escalation agent for NetEscalate.",
    `Speak with ${technician.name}.`,
    `Incident ${incident.incidentId}: ${incident.severity} severity network incident affecting ${incident.device} at ${incident.location}.`,
    `Problem: ${incident.description}.`,
    `Escalation level: ${level}.`,
    "Confirm that you are the assigned technician and ask whether you are available to take ownership of this incident.",
    "If the technician confirms availability and accepts the incident, set acknowledged=true, technician_available=true and escalation_required=false.",
    "If the technician cannot take the incident, set acknowledged=false and escalation_required=true.",
    "Do not invent technical details. Return a concise technician response."
  ].join(" ");

  console.log("========================================");
  console.log("CALL-E OUTBOUND CALL");
  console.log("Provider: CALL-E");
  console.log("Region:", CALLE_REGION);
  console.log("Locale:", CALLE_LOCALE);
  console.log("Capability:", capability.state);
  console.log("Incident:", incident.incidentId);
  console.log("Technician:", technician.name);
  console.log("Phone:", technician.phone);
  console.log("Level:", level);
  console.log("========================================");

  try {
    const createResponse = await axios.post(
      `${CALLE_BASE_URL.replace(/\/$/, "")}/v1/calls`,
      {
        task,
        recipients: [{ phones: [technician.phone], region: CALLE_REGION, locale: CALLE_LOCALE }],
        result_schema: resultSchema,
        metadata: {
          source: "net-escalate",
          incidentId: incident.incidentId,
          device: incident.device,
          location: incident.location,
          severity: incident.severity,
          escalationLevel: level,
          technicianId: technician.id,
          technicianName: technician.name
        }
      },
      { headers: headers(idempotencyKey), timeout: 30000 }
    );

    let result = normalizeCallResponse(createResponse.data);
    if (!result.id) throw new CalleProviderError("CALL-E did not return a call ID.", { code: "missing_call_id" });

    const startedAt = Date.now();
    while (!isTerminal(result.status)) {
      if (Date.now() - startedAt >= CALLE_MAX_WAIT_MS) {
        throw new CalleProviderError(`CALL-E call ${result.id} did not reach a terminal state within ${CALLE_MAX_WAIT_MS}ms. The call ID has been retained for recovery: ${result.id}`, { code: "call_timeout", retryable: true });
      }
      await wait(CALLE_POLL_INTERVAL_MS);
      result = await getCallStatus(result.id);
    }

    return result;
  } catch (error) {
    if (error instanceof CalleProviderError) throw error;
    if (error.response) {
      const parsed = parseProviderError(error);
      const permanent = parsed.status >= 400 && parsed.status < 500 && ["call_not_ready", "unsupported_region", "unsupported_locale", "invalid_destination"].includes(parsed.code);
      console.error("CALL-E API ERROR:", parsed.status, parsed.code, parsed.message, parsed.details || "");
      throw new CalleProviderError(parsed.message, {
        code: parsed.code || "provider_http_error",
        status: parsed.status,
        retryable: !permanent,
        details: parsed.details
      });
    }
    console.error("CALL-E request error:", error);
    throw new CalleProviderError(error.message || "Failed to start CALL-E call.", { code: "network_error", retryable: true });
  }
}

export async function getCallStatus(callId) {
  if (!callId) throw new Error("Call ID is required.");
  validateConfiguration();
  try {
    const response = await axios.get(`${CALLE_BASE_URL.replace(/\/$/, "")}/v1/calls/${encodeURIComponent(callId)}`, { headers: headers(), timeout: 15000 });
    return normalizeCallResponse(response.data);
  } catch (error) {
    if (error.response) {
      const parsed = parseProviderError(error);
      throw new CalleProviderError(parsed.message, { code: parsed.code || "status_error", status: parsed.status, retryable: parsed.status >= 500, details: parsed.details });
    }
    throw new CalleProviderError(error.message || "Failed to retrieve CALL-E call status.", { code: "network_error", retryable: true });
  }
}
