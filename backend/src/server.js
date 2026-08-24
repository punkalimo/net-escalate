import "dotenv/config";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import {
  createServer
} from "http";

import {
  Server
} from "socket.io";


import incidentRoutes
  from "./routes/incidentRoutes.js";

import technicianRoutes
  from "./routes/technicianRoutes.js";

import deviceRoutes
  from "./routes/deviceRoutes.js";


import { startAllDeviceMonitoring, setMonitoringSocket } from "./services/deviceMonitoringService.js";


const app =
  express();


/*
 * ========================================
 * HTTP REQUEST LOGGER
 * ========================================
 */

app.use(
  (req, res, next) => {

    console.log(
      "REQUEST:",
      req.method,
      req.url
    );

    next();

  }
);


/*
 * ========================================
 * HTTP SERVER
 * ========================================
 */

const httpServer =
  createServer(
    app
  );


/*
 * ========================================
 * SOCKET.IO
 * ========================================
 */

const io =
  new Server(
    httpServer,
    {

      cors: {

        origin:
          process.env.FRONTEND_URL ||
          "*",

        methods: [
          "GET",
          "POST",
          "PATCH",
          "DELETE"
        ]

      }

    }
  );

setMonitoringSocket(io);
/*
 * Make Socket.IO globally available
 * to monitoring services.
 */

global.io =
  io;


/*
 * ========================================
 * CORS
 * ========================================
 */

app.use(
  cors({

    origin:
      process.env.FRONTEND_URL ||
      "*"

  })
);


/*
 * ========================================
 * JSON
 * ========================================
 */

app.use(
  express.json()
);


/*
 * ========================================
 * ROOT
 * ========================================
 */

app.get(
  "/",
  (req, res) => {

    res.json({

      name:
        "NetEscalate AI",

      status:
        "online"

    });

  }
);


/*
 * ========================================
 * HEALTH
 * ========================================
 */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      status:
        "healthy",

      service:
        "NetEscalate API"

    });

  }
);


/*
 * ========================================
 * API ROUTES
 * ========================================
 */

app.use(
  "/api/incidents",
  incidentRoutes(io)
);


app.use(
  "/api/technicians",
  technicianRoutes
);


app.use(
  "/api/devices",
  deviceRoutes
);


/*
 * ========================================
 * SOCKET.IO
 * ========================================
 */

io.on(
  "connection",
  socket => {

    console.log(
      "Dashboard connected:",
      socket.id
    );


    socket.on(
      "disconnect",
      () => {

        console.log(
          "Dashboard disconnected:",
          socket.id
        );

      }
    );

  }
);


/*
 * ========================================
 * PORT
 * ========================================
 */

const PORT =
  process.env.PORT ||
  5000;


/*
 * ========================================
 * START SERVER
 * ========================================
 */

async function startServer() {

  try {

    await mongoose.connect(
      process.env.MONGODB_URI
    );


    console.log(
      "MongoDB connected"
    );


    /*
     * Start monitoring all devices
     * already stored in MongoDB.
     */

    await startAllDeviceMonitoring();


    httpServer.listen(
      PORT,
      () => {

        console.log(
          `NetEscalate API running on http://localhost:${PORT}`
        );

      }
    );

  } catch (error) {

    console.error(
      "Failed to start server:",
      error
    );


    process.exit(
      1
    );

  }

}


startServer();