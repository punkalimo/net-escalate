import express from "express";
import Incident from "../models/Incident.js";
import { processIncident } from "../services/incidentService.js";

function generateIncidentId() {
  const number = Math.floor(1000 + Math.random() * 9000);

  return `NET-${number}`;
}

export default function incidentRoutes(io) {
  const router = express.Router();

  /*
   * CREATE INCIDENT
   */
  router.post("/", async (req, res) => {
    try {
      const {
        device,
        location,
        severity,
        description,
        technician
      } = req.body;

      if (
        !device ||
        !location ||
        !severity ||
        !description ||
        !technician?.phone
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required incident information."
        });
      }

      const incident = await Incident.create({
        incidentId: generateIncidentId(),
        device,
        location,
        severity,
        description,
        technician
      });

      /*
       * Notify dashboard immediately
       */
      if (io) {
        io.emit("incident_created", incident);
      }

      /*
       * Start escalation workflow
       */
      processIncident(incident, io).catch(error => {
        console.error(
          "Escalation workflow error:",
          error
        );
      });

      return res.status(201).json({
        success: true,
        message:
          "Incident created and escalation workflow started.",
        incident
      });

    } catch (error) {
      console.error(
        "CREATE INCIDENT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to create incident.",
        error: error.message
      });
    }
  });


  /*
   * GET ALL INCIDENTS
   */
  router.get("/", async (req, res) => {
    console.log("========================================");
    console.log("GET /api/incidents received");
    console.log("MongoDB readyState:", Incident.db.readyState);

    try {
      console.log("Running Incident.find()...");

      const incidents = await Incident
        .find({})
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      console.log(
        "MongoDB query completed."
      );

      console.log(
        "Incidents found:",
        incidents.length
      );

      return res.json({
        success: true,
        incidents
      });

    } catch (error) {
      console.error(
        "GET INCIDENTS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to retrieve incidents.",
        error: error.message
      });
    }
  });


  /*
   * GET SINGLE INCIDENT
   */
  router.get("/:incidentId", async (req, res) => {
    try {
      const incident = await Incident
        .findOne({
          incidentId: req.params.incidentId
        })
        .lean()
        .exec();

      if (!incident) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      return res.json({
        success: true,
        incident
      });

    } catch (error) {
      console.error(
        "GET SINGLE INCIDENT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to retrieve incident.",
        error: error.message
      });
    }
  });


  /*
   * RESOLVE INCIDENT
   */
  router.patch(
    "/:incidentId/resolve",
    async (req, res) => {
      try {
        const incident =
          await Incident.findOneAndUpdate(
            {
              incidentId:
                req.params.incidentId
            },
            {
              status: "RESOLVED",
              resolvedAt: new Date()
            },
            {
              new: true
            }
          );

        if (!incident) {
          return res.status(404).json({
            success: false,
            message: "Incident not found."
          });
        }

        /*
         * Notify dashboards
         */
        if (io) {
          io.emit(
            "incident_updated",
            incident
          );
        }

        return res.json({
          success: true,
          incident
        });

      } catch (error) {
        console.error(
          "RESOLVE INCIDENT ERROR:",
          error
        );

        return res.status(500).json({
          success: false,
          message: "Failed to resolve incident.",
          error: error.message
        });
      }
    }
  );


  return router;
}