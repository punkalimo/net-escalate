import express from "express";
import Technician from "../models/Technician.js";

const router = express.Router();


/**
 * Get all technicians
 */
router.get("/", async (req, res) => {
  try {
    const technicians = await Technician
      .find()
      .sort({ level: 1, name: 1 });

    res.json({
      success: true,
      technicians
    });

  } catch (error) {
    console.error(
      "Get technicians error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to retrieve technicians."
    });
  }
});


/**
 * Create technician
 */
router.post("/", async (req, res) => {
  try {
    const {
      technicianId,
      name,
      phone,
      level,
      role,
      active
    } = req.body;

    if (
      !technicianId ||
      !name ||
      !phone ||
      !level
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required technician information."
      });
    }

    const technician = await Technician.create({
      technicianId,
      name,
      phone,
      level,
      role,
      active
    });

    res.status(201).json({
      success: true,
      technician
    });

  } catch (error) {
    console.error(
      "Create technician error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to create technician."
    });
  }
});


/**
 * Get technicians for an escalation level
 */
router.get("/level/:level", async (req, res) => {
  try {
    const level = Number(req.params.level);

    const technicians = await Technician.find({
      level,
      active: true
    });

    res.json({
      success: true,
      technicians
    });

  } catch (error) {
    console.error(
      "Get technicians by level error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to retrieve technicians."
    });
  }
});


export default router;