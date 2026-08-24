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
import { startAllDeviceMonitoring, setMonitoringSocket } from "./services/deviceMonitoringService.js";

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

io.on("connection", socket => {
  console.log("Dashboard connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Dashboard disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");

    await startAllDeviceMonitoring();

    httpServer.listen(PORT, () => {
      console.log(`NetEscalate API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
