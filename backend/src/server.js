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
// credentials:true requires an explicit origin, not "*" - the auth cookie
// depends on this (see authRoutes.js).
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || "http://localhost:5173";
const io = new Server(httpServer, { cors: { origin: FRONTEND_ORIGIN, methods: ["GET", "POST", "PATCH", "DELETE"], credentials: true } });
setMonitoringSocket(io);
global.io = io;
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
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
app.use("/api/interfaces", interfaceRoutes);
app.use("/api/topology", topologyRoutes);
app.use("/api/topology", devicePathRoutes);
app.use("/api/phase4", phase4Routes(io));
// Mirrors attachRealmScope's logic exactly (see its comment) so a socket's
// realm room matches whatever the same session's REST requests are scoped
// to - including a platform admin's Enter Realm context, so live updates
// keep working during a support session.
io.use((socket, next) => {
  try {
    const cookies = parseCookie(socket.handshake.headers.cookie || "");
    const user = verifyAuthToken(cookies[AUTH_COOKIE_NAME]);
    socket.user = user;
    if (user.platformRole) {
      try {
        const context = verifyRealmContext(cookies[REALM_CONTEXT_COOKIE_NAME]);
        socket.realmId = context.realmId;
      } catch (contextError) {
        socket.realmId = null;
      }
    } else {
      socket.realmId = user.realmId || null;
    }
    return next();
  } catch (error) {
    return next(new Error("unauthorized"));
  }
});
io.on("connection", socket => {
  console.log("Dashboard connected:", socket.id, `(${socket.user?.username})`);
  // Every realm-scoped push (see realtimeService.js's emitToRealm) targets
  // this room - a socket with no realmId (a platform admin who hasn't
  // entered a realm) simply joins nothing and receives no tenant-owned
  // real-time events, matching how their REST requests behave too.
  if (socket.realmId) socket.join(String(socket.realmId));
  socket.on("disconnect", () => console.log("Dashboard disconnected:", socket.id));
});
const PORT = process.env.PORT || 5000;
let monitoringStarted = false;
function startBackgroundMonitoring() { if (monitoringStarted) return; monitoringStarted = true; Promise.allSettled([startAllDeviceMonitoring(), startAllInterfaceMonitoring()]).then(results => results.forEach((result, index) => { const name = index === 0 ? "device monitoring" : "interface monitoring"; if (result.status === "fulfilled") console.log(`[STARTUP] ${name} initialized.`); else console.error(`[STARTUP] ${name} failed:`, result.reason); })); startSeverityEscalationSweep(); startIncidentCorrelationSweep(); startEscalationTimeoutSweep(); startConfigSnapshotSweep(); }
async function listen() { await new Promise((resolve, reject) => { const onError = error => { httpServer.off("listening", onListening); reject(error); }; const onListening = () => { httpServer.off("error", onError); resolve(); }; httpServer.once("error", onError); httpServer.once("listening", onListening); httpServer.listen(PORT); }); }
async function startServer() { try { if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured."); await mongoose.connect(process.env.MONGODB_URI); console.log("MongoDB connected"); await listen(); console.log(`NetEscalate API running on http://localhost:${PORT}`); console.log("[STARTUP] Dashboard/API ready; starting monitoring in background."); startBackgroundMonitoring(); } catch (error) { if (error?.code === "EADDRINUSE") console.error(`[STARTUP] Port ${PORT} is already in use. Stop the existing NetEscalate process or choose another PORT.`); else console.error("Failed to start server:", error); process.exit(1); } }
async function shutdown(signal) { console.log(`[SHUTDOWN] ${signal} received; closing server connections.`); stopSeverityEscalationSweep(); stopIncidentCorrelationSweep(); stopEscalationTimeoutSweep(); stopConfigSnapshotSweep(); io.close(); await new Promise(resolve => httpServer.close(() => resolve())); await mongoose.disconnect(); process.exit(0); }
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
startServer();
