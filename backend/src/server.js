import "dotenv/config";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";

import incidentRoutes from "./routes/incidentRoutes.js";
import technicianRoutes from "./routes/technicianRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import interfaceRoutes from "./routes/interfaceRoutes.js";
import topologyRoutes from "./routes/topologyRoutes.js";
import devicePathRoutes from "./routes/devicePathRoutes.js";

import { startAllDeviceMonitoring, setMonitoringSocket } from "./services/deviceMonitoringService.js";
import { startAllInterfaceMonitoring } from "./services/interfaceMonitoringService.js";

const app = express();

app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

setMonitoringSocket(io);
global.io = io;

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ name: "NetEscalate AI", status: "online" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", service: "NetEscalate API" });
});

app.use("/api/incidents", incidentRoutes(io));
app.use("/api/technicians", technicianRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/interfaces", interfaceRoutes);
app.use("/api/topology", topologyRoutes);
app.use("/api/topology", devicePathRoutes);

io.on("connection", socket => {
  console.log("Dashboard connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Dashboard disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

function startBackgroundMonitoring() {
  Promise.allSettled([
    startAllDeviceMonitoring(),
    startAllInterfaceMonitoring()
  ]).then(results => {
    results.forEach((result, index) => {
      const name = index === 0 ? "device monitoring" : "interface monitoring";
      if (result.status === "fulfilled") {
        console.log(`[STARTUP] ${name} initialized.`);
      } else {
        console.error(`[STARTUP] ${name} failed:`, result.reason);
      }
    });
  });
}

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");

    // The API and Socket.IO server must become available before any device
    // monitoring begins. SNMP/ping timeouts can take seconds per device and
    // should never block dashboard readiness.
    await new Promise((resolve, reject) => {
      const onError = error => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(PORT);
    });

    console.log(`NetEscalate API running on http://localhost:${PORT}`);
    console.log("[STARTUP] Dashboard/API ready; starting monitoring in background.");

    startBackgroundMonitoring();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
