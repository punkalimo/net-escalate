import { callTechnician } from "./calleService.js";


/*
 * ========================================
 * CALL PROVIDER CONFIGURATION
 * ========================================
 *
 * Supported providers:
 *
 * simulation
 * calle
 *
 * For development/testing, use:
 *
 * CALL_PROVIDER=simulation
 *
 * For the real CALL-E integration, use:
 *
 * CALL_PROVIDER=calle
 */

const CALL_PROVIDER =
  process.env.CALL_PROVIDER ||
  "simulation";


/*
 * ========================================
 * SIMULATION CONFIGURATION
 * ========================================
 *
 * Supported scenarios:
 *
 * acknowledge
 *
 *     Level 1 acknowledges.
 *
 *
 * level1_fail_level2_acknowledge
 *
 *     Level 1 fails.
 *     Level 2 acknowledges.
 *
 *
 * all_fail
 *
 *     Level 1 fails.
 *     Level 2 fails.
 *     Level 3 fails.
 */

const SIMULATION_SCENARIO =
  process.env.SIMULATION_SCENARIO ||
  "acknowledge";


/*
 * ========================================
 * SIMULATION CALL DELAY
 * ========================================
 *
 * Three seconds gives the dashboard time
 * to show CALLING before the response.
 */

const SIMULATION_CALL_DELAY =
  Number(
    process.env.SIMULATION_CALL_DELAY || 3000
  );


/*
 * ========================================
 * WAIT HELPER
 * ========================================
 */

function wait(
  milliseconds
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
  );

}


/*
 * ========================================
 * CREATE SIMULATION RESULT
 * ========================================
 */

function createSimulationResult({

  acknowledged = false,

  technicianAvailable = false,

  escalationRequired = true,

  technicianResponse

}) {

  return {

    id:
      `SIM-${Date.now()}`,

    structuredResult: {

      acknowledged,

      technician_available:
        technicianAvailable,

      escalation_required:
        escalationRequired,

      technician_response:
        technicianResponse

    }

  };

}


/*
 * ========================================
 * SIMULATE TECHNICIAN CALL
 * ========================================
 */

async function simulateTechnicianCall(
  incident
) {

  const level =
    Number(
      incident.escalationLevel
    ) || 1;


  const technician =
    incident.technician;


  console.log(
    "========================================"
  );

  console.log(
    "SIMULATED CALL STARTED"
  );

  console.log(
    "Incident:",
    incident.incidentId
  );

  console.log(
    "Technician:",
    technician?.name ||
      "Unknown"
  );

  console.log(
    "Phone:",
    technician?.phone ||
      "Unknown"
  );

  console.log(
    "Escalation Level:",
    level
  );

  console.log(
    "Scenario:",
    SIMULATION_SCENARIO
  );

  console.log(
    "========================================"
  );


  /*
   * ========================================
   * SIMULATE CALL DURATION
   * ========================================
   */

  await wait(
    SIMULATION_CALL_DELAY
  );


  /*
   * ========================================
   * SCENARIO: ACKNOWLEDGE
   * ========================================
   *
   * Every level acknowledges.
   *
   * In normal operation, the first Level 1
   * technician therefore stops escalation.
   */

  if (
    SIMULATION_SCENARIO ===
    "acknowledge"
  ) {

    console.log(
      `SIMULATION: ${technician?.name} acknowledged incident.`
    );


    return createSimulationResult({

      acknowledged:
        true,

      technicianAvailable:
        true,

      escalationRequired:
        false,

      technicianResponse:
        "Technician confirmed availability and will investigate the incident."

    });

  }


  /*
   * ========================================
   * SCENARIO: LEVEL 1 FAIL → LEVEL 2 ACK
   * ========================================
   *
   * Level 1:
   *     unavailable
   *
   * Level 2:
   *     acknowledges
   *
   * Level 3:
   *     should never be reached
   */

  if (
    SIMULATION_SCENARIO ===
      "level1_fail_level2_acknowledge" ||
    SIMULATION_SCENARIO ===
      "chain"
  ) {


    /*
     * LEVEL 1
     */

    if (
      level === 1
    ) {

      console.log(
        `SIMULATION: ${technician?.name} at Level 1 could not handle incident.`
      );


      return createSimulationResult({

        acknowledged:
          false,

        technicianAvailable:
          false,

        escalationRequired:
          true,

        technicianResponse:
          "Level 1 technician is unavailable. Escalation to Level 2 is required."

      });

    }


    /*
     * LEVEL 2
     */

    if (
      level === 2
    ) {

      console.log(
        `SIMULATION: ${technician?.name} at Level 2 acknowledged incident.`
      );


      return createSimulationResult({

        acknowledged:
          true,

        technicianAvailable:
          true,

        escalationRequired:
          false,

        technicianResponse:
          "Level 2 technician confirmed availability and will investigate the incident."

      });

    }


    /*
     * LEVEL 3 SAFETY FALLBACK
     *
     * Level 3 should normally never be
     * reached in this scenario.
     */

    console.log(
      `SIMULATION: ${technician?.name} at Level 3 is unavailable.`
    );


    return createSimulationResult({

      acknowledged:
        false,

      technicianAvailable:
        false,

      escalationRequired:
        true,

      technicianResponse:
        "Level 3 technician unavailable."

    });

  }


  /*
   * ========================================
   * SCENARIO: ALL FAIL
   * ========================================
   *
   * Every level returns an escalation request.
   *
   * Level 1 → fail
   * Level 2 → fail
   * Level 3 → fail
   *
   * incidentService.js will then mark the
   * incident as FAILED.
   */

  if (
    SIMULATION_SCENARIO ===
    "all_fail"
  ) {

    console.log(
      `SIMULATION: ${technician?.name} at Level ${level} failed to accept incident.`
    );


    return createSimulationResult({

      acknowledged:
        false,

      technicianAvailable:
        false,

      escalationRequired:
        true,

      technicianResponse:
        `Level ${level} technician is unavailable. Escalation to the next level is required.`

    });

  }


  /*
   * ========================================
   * SCENARIO: NO ANSWER
   * ========================================
   *
   * Optional additional scenario.
   *
   * This behaves like a call that was made
   * but nobody answered.
   */

  if (
    SIMULATION_SCENARIO ===
    "no_answer"
  ) {

    console.log(
      `SIMULATION: ${technician?.name} did not answer.`
    );


    return createSimulationResult({

      acknowledged:
        false,

      technicianAvailable:
        false,

      escalationRequired:
        true,

      technicianResponse:
        "Technician did not answer the call."

    });

  }


  /*
   * ========================================
   * SCENARIO: DECLINE
   * ========================================
   *
   * Optional scenario where the technician
   * answers but declines the incident.
   */

  if (
    SIMULATION_SCENARIO ===
    "decline"
  ) {

    console.log(
      `SIMULATION: ${technician?.name} declined the incident.`
    );


    return createSimulationResult({

      acknowledged:
        false,

      technicianAvailable:
        true,

      escalationRequired:
        true,

      technicianResponse:
        "Technician answered but declined the incident."

    });

  }


  /*
   * ========================================
   * UNKNOWN SCENARIO
   * ========================================
   */

  throw new Error(
    `Unknown SIMULATION_SCENARIO: ${SIMULATION_SCENARIO}`
  );

}


/*
 * ========================================
 * ESCALATE TO TECHNICIAN
 * ========================================
 *
 * This is the main entry point used by:
 *
 * incidentService.js
 *
 * It decides whether the application should
 * use the simulation or the real CALL-E provider.
 */

export async function escalateToTechnician(
  incident
) {

  console.log(
    "========================================"
  );

  console.log(
    "ESCALATION PROVIDER"
  );

  console.log(
    "Provider:",
    CALL_PROVIDER
  );

  console.log(
    "Incident:",
    incident?.incidentId
  );

  console.log(
    "Level:",
    incident?.escalationLevel
  );

  console.log(
    "Technician:",
    incident?.technician?.name
  );

  console.log(
    "========================================"
  );


  /*
   * ========================================
   * SIMULATION PROVIDER
   * ========================================
   */

  if (
    CALL_PROVIDER ===
    "simulation"
  ) {

    return await simulateTechnicianCall(
      incident
    );

  }


  /*
   * ========================================
   * CALL-E PROVIDER
   * ========================================
   */

  if (
    CALL_PROVIDER ===
    "calle"
  ) {

    return await callTechnician(
      incident
    );

  }


  /*
   * ========================================
   * INVALID PROVIDER
   * ========================================
   */

  throw new Error(
    `Unknown CALL_PROVIDER: ${CALL_PROVIDER}. ` +
    `Supported providers are "simulation" and "calle".`
  );

}