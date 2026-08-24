import axios from "axios";

/*
 * ========================================
 * CALL-E CONFIGURATION
 * ========================================
 */

const CALLE_API_URL =
  process.env.CALLE_API_URL || "";

const CALLE_API_KEY =
  process.env.CALLE_API_KEY || "";

const CALLE_AGENT_ID =
  process.env.CALLE_AGENT_ID || "";


/*
 * ========================================
 * VALIDATE CONFIGURATION
 * ========================================
 */

function validateConfiguration() {
  if (!CALLE_API_URL) {
    throw new Error(
      "CALLE_API_URL is not configured."
    );
  }

  if (!CALLE_API_KEY) {
    throw new Error(
      "CALLE_API_KEY is not configured."
    );
  }

  if (!CALLE_AGENT_ID) {
    throw new Error(
      "CALLE_AGENT_ID is not configured."
    );
  }
}


/*
 * ========================================
 * NORMALIZE CALL-E RESPONSE
 * ========================================
 *
 * Different versions/configurations of
 * the provider may return slightly
 * different response structures.
 *
 * This function keeps the rest of the
 * application working with one format.
 */

function normalizeCallResponse(data) {

  const structuredResult =
    data?.structuredResult ||
    data?.structured_result ||
    data?.result ||
    data?.analysis ||
    {};


  return {

    id:
      data?.id ||
      data?.callId ||
      data?.call_id ||
      null,

    structuredResult: {

      acknowledged:
        structuredResult?.acknowledged === true,

      technician_available:
        structuredResult?.technician_available === true,

      escalation_required:
        structuredResult?.escalation_required === true,

      technician_response:
        structuredResult?.technician_response ||
        structuredResult?.response ||
        data?.transcript ||
        data?.summary ||
        null

    },

    raw: data

  };

}


/*
 * ========================================
 * CALL TECHNICIAN
 * ========================================
 *
 * Starts an outbound AI call to the
 * technician assigned to the incident.
 *
 * The AI agent is expected to determine:
 *
 * 1. Whether the technician answered
 * 2. Whether the technician is available
 * 3. Whether they acknowledge the incident
 * 4. Whether escalation is required
 */

export async function callTechnician(
  incident
) {

  if (!incident) {

    throw new Error(
      "Incident is required."
    );

  }


  const technician =
    incident.technician;


  if (!technician) {

    throw new Error(
      "Incident does not have an assigned technician."
    );

  }


  if (!technician.phone) {

    throw new Error(
      "Technician does not have a phone number."
    );

  }


  /*
   * Validate CALL-E configuration.
   */

  validateConfiguration();


  /*
   * ========================================
   * CALL DATA
   * ========================================
   */

  const payload = {

    agent_id:
      CALLE_AGENT_ID,

    phone_number:
      technician.phone,

    metadata: {

      incidentId:
        incident.incidentId,

      device:
        incident.device,

      location:
        incident.location,

      severity:
        incident.severity,

      description:
        incident.description,

      escalationLevel:
        incident.escalationLevel,

      technicianId:
        technician.id,

      technicianName:
        technician.name

    },

    variables: {

      incident_id:
        incident.incidentId,

      device:
        incident.device,

      location:
        incident.location,

      severity:
        incident.severity,

      description:
        incident.description,

      escalation_level:
        String(
          incident.escalationLevel || 1
        ),

      technician_name:
        technician.name

    }

  };


  console.log(
    "========================================"
  );

  console.log(
    "CALL-E OUTBOUND CALL"
  );

  console.log(
    "Incident:",
    incident.incidentId
  );

  console.log(
    "Technician:",
    technician.name
  );

  console.log(
    "Phone:",
    technician.phone
  );

  console.log(
    "Level:",
    incident.escalationLevel
  );

  console.log(
    "========================================"
  );


  try {

    /*
     * ========================================
     * SEND CALL REQUEST
     * ========================================
     *
     * The exact endpoint can be changed here
     * if your CALL-E account uses a different
     * endpoint.
     */

    const response =
      await axios.post(
        `${CALLE_API_URL}/calls`,
        payload,
        {

          headers: {

            Authorization:
              `Bearer ${CALLE_API_KEY}`,

            "Content-Type":
              "application/json"

          },

          timeout:
            30000

        }
      );


    console.log(
      "CALL-E response received."
    );


    /*
     * Normalize provider response.
     */

    const result =
      normalizeCallResponse(
        response.data
      );


    /*
     * Make sure a call ID exists.
     */

    if (!result.id) {

      console.warn(
        "CALL-E response did not contain a call ID."
      );

    }


    return result;


  } catch (error) {

    /*
     * ========================================
     * ERROR HANDLING
     * ========================================
     */

    if (error.response) {

      console.error(
        "CALL-E API ERROR:"
      );

      console.error(
        "Status:",
        error.response.status
      );

      console.error(
        "Response:",
        error.response.data
      );


      throw new Error(
        error.response.data?.message ||
        error.response.data?.error ||
        `CALL-E request failed with status ${error.response.status}.`
      );

    }


    if (error.request) {

      console.error(
        "CALL-E did not respond."
      );


      throw new Error(
        "CALL-E did not respond to the outbound call request."
      );

    }


    console.error(
      "CALL-E request error:",
      error
    );


    throw new Error(
      error.message ||
      "Failed to start CALL-E call."
    );

  }

}


/*
 * ========================================
 * GET CALL STATUS
 * ========================================
 *
 * Optional helper for checking the status
 * of an existing CALL-E call.
 */

export async function getCallStatus(
  callId
) {

  if (!callId) {

    throw new Error(
      "Call ID is required."
    );

  }


  validateConfiguration();


  try {

    const response =
      await axios.get(
        `${CALLE_API_URL}/calls/${callId}`,
        {

          headers: {

            Authorization:
              `Bearer ${CALLE_API_KEY}`,

            "Content-Type":
              "application/json"

          },

          timeout:
            15000

        }
      );


    return normalizeCallResponse(
      response.data
    );


  } catch (error) {

    if (error.response) {

      console.error(
        "CALL-E STATUS ERROR:",
        error.response.data
      );


      throw new Error(
        error.response.data?.message ||
        error.response.data?.error ||
        "Failed to retrieve CALL-E call status."
      );

    }


    throw new Error(
      error.message ||
      "Failed to retrieve CALL-E call status."
    );

  }

}