import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { parseCookie } from "cookie";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";
import authRoutes from "./routes/authRoutes.js";
import incidentRoutes from "./routes/incidentRoutes.js";
import technicianRoutes from "./routes/technicianRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import siteRoutes from "./routes/siteRoutes.js";
import interfaceRoutes from "./routes/interfaceRoutes.js";
import topologyRoutes from "./routes/topologyRoutes.js";
import devicePathRoutes from "./routes/devicePathRoutes.js";
import phase4Routes from "./routes/phase4Routes.js";
import platformRoutes from "./routes/platformRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import webmcpRoutes from "./routes/webmcpRoutes.js";
import { requireAuth, requirePlatform, attachRealmScope } from "./middleware/authMiddleware.js";
import { verifyAuthToken, AUTH_COOKIE_NAME, verifyRealmContext, REALM_CONTEXT_COOKIE_NAME } from "./services/authService.js";
import { startAllDeviceMonitoring, setMonitoringSocket } from "./services/deviceMonitoringService.js";
import { startAllInterfaceMonitoring } from "./services/interfaceMonitoringService.js";
import { startSeverityEscalationSweep, stopSeverityEscalationSweep } from "./services/severityService.js";
import { startIncidentCorrelationSweep, stopIncidentCorrelationSweep } from "./services/incidentCorrelationService.js";
import { startEscalationTimeoutSweep, stopEscalationTimeoutSweep } from "./services/escalationSweepService.js";
import { startConfigSnapshotSweep, stopConfigSnapshotSweep } from "./services/configSnapshotService.js";
const app = express();
const httpServer = createServer(app);
const startedAt = Date.now();

// Production frontend is hosted on Render. Keep an explicit allowlist for
// credentialed requests so the auth/session cookies work cross-origin.
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || "https://net-escalate-frontend.onrender.com";
const ALLOWED_ORIGINS = new Set([
  FRONTEND_ORIGIN,
  "https://net-escalate-frontend.onrender.com",
  "http://localhost:5173"
]);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true
};

const io = new Server(httpServer, { cors: { ...corsOptions, methods: ["GET", "POST", "PATCH", "DELETE"] } });
setMonitoringSocket(io);
global.io = io;
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.get("/", (req, res) => res.json({ name: "NetEscalate AI", status: "online", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
app.get("/api/health", async (req, res) => { const mongoReady = mongoose.connection.readyState === 1; return res.status(mongoReady ? 200 : 503).json({ status: mongoReady ? "healthy" : "degraded", service: "NetEscalate API", database: mongoReady ? "connected" : "disconnected", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), timestamp: new Date().toISOString() }); });
app.use("/api/auth", authRoutes());
// Everything else under /api requires a valid session - registered after
// /api/health and /api/auth above, so those stay public (Express matches
// middleware in registration order).
app.use("/api", requireAuth);
// Platform routes are a separate authority axis (requirePlatform, not tied
// to any single realm) - mounted before attachRealmScope/the tenant routes
// below since they don't want a realm filter forced onto them.
app.use("/api/platform", requirePlatform, platformRoutes());
// Every tenant-scoped route below relies on req.realmId, computed here from
// the authenticated session (or a platform admin's Enter Realm context) -
// see attachRealmScope's own comment for why this must never come from a
// client-supplied param.
app.use("/api", attachRealmScope);
app.use("/api/incidents", incidentRoutes(io));
app.use("/api/technicians", technicianRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/interfaces", interfaceRoutes);
app.use("/api/topology", topologyRoutes);
app.use("/api/topology", devicePathRoutes);
app.use("/api/phase4", phase4Routes(io));
// The WebMCP agent-tool surface (see docs/WEBMCP.md) - mounted after
// attachRealmScope on purpose, same as every tenant route above, so a tool
// call is scoped by req.realmId exactly like a normal dashboard request.
app.use("/api/webmcp", webmcpRoutes(io));
// Mirrors attachRealmScope's logic exactly (see its comment) so a socket's
// realm room matches whatever the same session's REST requests are scoped
// to - including a platform admin's Enter Realm context, so live updates
// keep working during a support session.
io.use((socket, next) => {
  try {
    const cookies = parseCookie(socket.handshake.headers.cookie || "");
    const user = verifyAuthToken(cookies[AUTH_COOKIE_NAME]);
    socket.user = user;
    socket.technicianId = user.technicianId || null;
    if (user.platformRole) {
      const realmContext = verifyRealmContext(cookies[REALM_CONTEXT_COOKIE_NAME]);
      socket.realmId = realmContext?.realmId || null;
    } else {
      socket.realmId = user.realmId || null;
    }
    next();
  } catch (err) {
    next(err);
  }
});

const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`NetEscalate API listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  stopSeverityEscalationSweep();
  stopIncidentCorrelationSweep();
  stopEscalationTimeoutSweep();
  stopConfigSnapshotSweep();
  server.close(() => process.exit(0));
});

startAllDeviceMonitoring();
startAllInterfaceMonitoring();
startSeverityEscalationSweep();
startIncidentCorrelationSweep();
startEscalationTimeoutSweep();
startConfigSnapshotSweep();
