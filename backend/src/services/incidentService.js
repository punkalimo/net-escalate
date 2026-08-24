import Technician from "../models/Technician.js";
import { escalateToTechnician } from "./escalationService.js";


/*
 * ========================================
 * INCIDENT ESCALATION SERVICE
 * ========================================
 *
 * Escalation flow:
 *
 * Level 1 → Level 2 → Level 3
 *
 * If technician acknowledges:
 *
 * CALLING → ACKNOWLEDGED
 *
 * If technician cannot handle the incident:
 *
 * CALLING → ESCALATING → next level
 *
 * If all levels fail:
 *
 * FAILED
 */


/*
 * Maximum escalation level.
 */

const MAX_LEVEL = 3;


/*
 * ========================================
 * EMIT INCIDENT UPDATE
 * ========================================
 */

function emitIncidentUpdate(
  io,
  incident
) {

  if (!io) {
    return;
  }

  io.emit(
    "incident_updated",
    incident
  );

}


/*
 * ========================================
 * GET TECHNICIAN FOR LEVEL
 * ========================================
 */

async function getTechnicianForLevel(
  level
) {

  const technicians =
    await Technician
      .find({
        level,
        active: true
      })
      .sort({
        createdAt: 1
      });


  if (
    !technicians ||
    technicians.length === 0
  ) {

    return null;

  }


  /*
   * For now we select the first active
   * technician at the level.
   *
   * Later we can implement:
   *
   * - round robin
   * - availability
   * - workload
   * - geographical routing
   */

  return technicians[0];

}


/*
 * ========================================
 * ADD ESCALATION HISTORY
 * ========================================
 */

function addHistoryEntry(
  incident,
  technician,
  level
) {

  const entry = {

    level,

    technicianId:
      technician.technicianId,

    technicianName:
      technician.name,

    technicianPhone:
      technician.phone,

    callId: null,

    status: "CALLING",

    response: null,

    startedAt:
      new Date(),

    completedAt: null

  };


  incident.escalationHistory.push(
    entry
  );


  return (
    incident.escalationHistory[
      incident.escalationHistory.length - 1
    ]
  );

}


/*
 * ========================================
 * PROCESS INCIDENT
 * ========================================
 */

export async function processIncident(
  incident,
  io
) {

  try {

    /*
     * Start at the incident's current
     * escalation level.
     */

    let level =
      Number(
        incident.escalationLevel || 1
      );


    /*
     * ========================================
     * ESCALATION LOOP
     * ========================================
     */

    while (
      level <= MAX_LEVEL
    ) {

      console.log(
        "========================================"
      );

      console.log(
        `Processing escalation level ${level}`
      );

      console.log(
        `Incident: ${incident.incidentId}`
      );

      console.log(
        "========================================"
      );


      /*
       * ========================================
       * FIND TECHNICIAN
       * ========================================
       */

      const technician =
        await getTechnicianForLevel(
          level
        );


      /*
       * No technician exists at this level.
       */

      if (!technician) {

        console.log(
          `No active technician found at level ${level}.`
        );


        level += 1;


        /*
         * If another level exists,
         * continue escalation.
         */

        if (
          level <= MAX_LEVEL
        ) {

          incident.escalationLevel =
            level;

          incident.status =
            "ESCALATING";

          await incident.save();

          emitIncidentUpdate(
            io,
            incident
          );

          continue;

        }


        /*
         * No more levels.
         */

        incident.status =
          "FAILED";

        incident.escalationLevel =
          MAX_LEVEL;

        await incident.save();

        emitIncidentUpdate(
          io,
          incident
        );

        console.log(
          `No technicians available. Incident ${incident.incidentId} failed.`
        );

        return incident;

      }


      /*
       * ========================================
       * ASSIGN TECHNICIAN
       * ========================================
       */

      incident.technician = {

        id:
          technician.technicianId,

        name:
          technician.name,

        phone:
          technician.phone

      };


      incident.escalationLevel =
        level;


      incident.status =
        "CALLING";


      await incident.save();


      emitIncidentUpdate(
        io,
        incident
      );


      console.log(
        `Calling Level ${level} technician: ${technician.name}`
      );

      console.log(
        `Phone: ${technician.phone}`
      );


      /*
       * ========================================
       * CREATE HISTORY ENTRY
       * ========================================
       */

      const history =
        addHistoryEntry(
          incident,
          technician,
          level
        );


      await incident.save();


      emitIncidentUpdate(
        io,
        incident
      );


      /*
       * ========================================
       * CALL TECHNICIAN
       * ========================================
       */

      let callResult;


      try {

        callResult =
          await escalateToTechnician(
            incident
          );

      } catch (error) {

        console.error(
          `Call failed at Level ${level}:`,
          error
        );


        /*
         * Mark attempt as failed.
         */

        history.status =
          "FAILED";


        history.response =
          error.message ||
          "Call provider failed.";


        history.completedAt =
          new Date();


        await incident.save();


        emitIncidentUpdate(
          io,
          incident
        );


        /*
         * Move to next level.
         */

        level += 1;


        if (
          level <= MAX_LEVEL
        ) {

          incident.escalationLevel =
            level;

          incident.status =
            "ESCALATING";

          await incident.save();

          emitIncidentUpdate(
            io,
            incident
          );

          continue;

        }


        /*
         * All levels exhausted.
         */

        incident.status =
          "FAILED";

        incident.escalationLevel =
          MAX_LEVEL;

        await incident.save();

        emitIncidentUpdate(
          io,
          incident
        );

        return incident;

      }


      /*
       * ========================================
       * SAVE CALL ID
       * ========================================
       */

      incident.calleCallId =
        callResult?.id ||
        null;


      history.callId =
        incident.calleCallId;


      /*
       * ========================================
       * READ CALL RESULT
       * ========================================
       */

      const result =
        callResult?.structuredResult ||
        {};


      const acknowledged =
        result.acknowledged === true &&
        result.technician_available === true;


      const escalationRequired =
        result.escalation_required === true;


      /*
       * ========================================
       * TECHNICIAN ACKNOWLEDGED
       * ========================================
       */

      if (acknowledged) {

        incident.status =
          "ACKNOWLEDGED";


        incident.acknowledgement =
          result.technician_response ||
          "Technician acknowledged the incident.";


        history.status =
          "ACKNOWLEDGED";


        history.response =
          incident.acknowledgement;


        history.completedAt =
          new Date();


        await incident.save();


        emitIncidentUpdate(
          io,
          incident
        );


        console.log(
          "========================================"
        );

        console.log(
          `Incident ${incident.incidentId} acknowledged.`
        );

        console.log(
          `Technician: ${technician.name}`
        );

        console.log(
          "========================================"
        );


        /*
         * IMPORTANT:
         *
         * Stop escalation immediately.
         */

        return incident;

      }


      /*
       * ========================================
       * ESCALATION REQUIRED
       * ========================================
       */

      if (escalationRequired) {

        history.status =
          "ESCALATED";


        history.response =
          result.technician_response ||
          "Technician unavailable. Escalation required.";


        history.completedAt =
          new Date();


        await incident.save();


        emitIncidentUpdate(
          io,
          incident
        );


        console.log(
          `Level ${level} technician could not handle incident.`
        );


        /*
         * Move to next level.
         */

        level += 1;


        /*
         * More levels available.
         */

        if (
          level <= MAX_LEVEL
        ) {

          incident.escalationLevel =
            level;

          incident.status =
            "ESCALATING";

          await incident.save();

          emitIncidentUpdate(
            io,
            incident
          );


          continue;

        }


        /*
         * No more levels.
         */

        incident.status =
          "FAILED";

        incident.escalationLevel =
          MAX_LEVEL;

        await incident.save();

        emitIncidentUpdate(
          io,
          incident
        );


        console.log(
          `Incident ${incident.incidentId} exhausted all escalation levels.`
        );


        return incident;

      }


      /*
       * ========================================
       * UNCLEAR CALL RESULT
       * ========================================
       */

      history.status =
        "FAILED";


      history.response =
        result.technician_response ||
        "Call completed without a clear acknowledgement.";


      history.completedAt =
        new Date();


      await incident.save();


      emitIncidentUpdate(
        io,
        incident
      );


      /*
       * Try next level.
       */

      level += 1;


      if (
        level <= MAX_LEVEL
      ) {

        incident.escalationLevel =
          level;

        incident.status =
          "ESCALATING";

        await incident.save();

        emitIncidentUpdate(
          io,
          incident
        );

        continue;

      }


      /*
       * ========================================
       * ALL LEVELS EXHAUSTED
       * ========================================
       */

      incident.status =
        "FAILED";

      incident.escalationLevel =
        MAX_LEVEL;


      await incident.save();


      emitIncidentUpdate(
        io,
        incident
      );


      return incident;

    }


    /*
     * ========================================
     * SAFETY FALLBACK
     * ========================================
     */

    incident.status =
      "FAILED";

    incident.escalationLevel =
      MAX_LEVEL;


    await incident.save();


    emitIncidentUpdate(
      io,
      incident
    );


    return incident;


  } catch (error) {

    /*
     * ========================================
     * UNEXPECTED ERROR
     * ========================================
     */

    console.error(
      "========================================"
    );

    console.error(
      "INCIDENT PROCESSING ERROR"
    );

    console.error(
      error
    );

    console.error(
      "========================================"
    );


    incident.status =
      "FAILED";


    await incident.save();


    emitIncidentUpdate(
      io,
      incident
    );


    throw error;

  }

}