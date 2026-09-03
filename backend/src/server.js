import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { parseCookie } from "cookie";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server } from "socket.io";
import { rateLimit } from "express-rate-limit";
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
import oauthRoutes, { wellKnownRoutes } from "./routes/oauthRoutes.js";
import mcpRoutes from "./routes/mcpRoutes.js";
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

const DEFAULT_FRONTEND_ORIGIN = "https://net-escalate-frontend.onrender.com";
const normalizeOrigin = (value) => {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_FRONTEND_ORIGIN;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
};
const FRONTEND_ORIGIN = normalizeOrigin(process.env.FRONTEND_URL || DEFAULT_FRONTEND_ORIGIN);
const ALLOWED_ORIGINS = new Set([
  FRONTEND_ORIGIN,
  DEFAULT_FRONTEND_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedRequestOrigin = normalizeOrigin(origin);
    if (ALLOWED_ORIGINS.has(normalizedRequestOrigin)) return callback(null, true);
    console.warn(`CORS origin rejected: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

// /oauth and /mcp are the only two surfaces in this app reachable without an
// existing NetEscalate session cookie - see docs/WEBMCP.md's "Remote MCP +
// OAuth" section. Nothing else in the app has rate limiting today because
// everything else already sits behind requireAuth; these two are public by
// necessity (that's the whole point - a remote OAuth client has no cookie),
// so they get their own limiter instead.
const oauthRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const mcpRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

const io = new Server(httpServer, { cors: corsOptions });
setMonitoringSocket(io);
global.io = io;
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.get("/", (req, res) => res.json({ name: "NetEscalate AI", status: "online", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));
app.get("/api/health", async (req, res) => { const mongoReady = mongoose.connection.readyState === 1; return res.status(mongoReady ? 200 : 503).json({ status: mongoReady ? "healthy" : "degraded", service: "NetEscalate API", database: mongoReady ? "connected" : "disconnected", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), timestamp: new Date().toISOString() }); });
app.use("/api/auth", authRoutes());
app.use("/api", requireAuth);
app.use("/api/platform", requirePlatform, platformRoutes());
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
app.use("/api/webmcp", webmcpRoutes(io));

// Outside the /api namespace on purpose - these authenticate via OAuth
// Bearer tokens (mcpAuthMiddleware.js), not the requireAuth session cookie
// mounted on /api above, and must be reachable without ever having visited
// the dashboard first (a remote MCP client has no cookie to send).
app.use("/.well-known", wellKnownRoutes());
app.use("/oauth", oauthRateLimit, oauthRoutes());
app.use("/mcp", mcpRateLimit, mcpRoutes());

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
let server = null;

async function startBackend() {
  const mongoUri = String(process.env.MONGODB_URI || "").trim();

  if (!mongoUri) {
    throw new Error("MONGODB_URI is not configured. Add the MongoDB connection string to the Render backend environment variables.");
  }

  mongoose.connection.on("connected", () => {
    console.log("MongoDB connected.");
  });

  mongoose.connection.on("error", (error) => {
    console.error("MongoDB connection error:", error.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected.");
  });

  console.log("Connecting to MongoDB...");
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000
  });

  server = httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`NetEscalate API listening on port ${PORT}`);
  });

  // Render's edge can reuse HTTP connections longer than Node's defaults.
  // Keep the server-side connection alive long enough to avoid intermittent
  // 502s caused by the edge attempting to reuse a socket Node has closed.
  server.keepAliveTimeout = 120 * 1000;
  server.headersTimeout = 120 * 1000;

  // Background monitoring is operationally important, but a failure in one
  // worker must never take the HTTP API down. The API remains available while
  // the failing worker is logged for diagnosis/recovery instead of rethrowing
  // into the process-level startup failure handler.
  try {
    await startAllDeviceMonitoring();
    await startAllInterfaceMonitoring();
    startSeverityEscalationSweep();
    startIncidentCorrelationSweep();
    startEscalationTimeoutSweep();
    startConfigSnapshotSweep();
    console.log("NetEscalate background services started.");
  } catch (error) {
    console.error("Failed to start NetEscalate background services; API remains online:", error);
  }
}

process.on("SIGTERM", async () => {
  stopSeverityEscalationSweep();
  stopIncidentCorrelationSweep();
  stopEscalationTimeoutSweep();
  stopConfigSnapshotSweep();

  if (server) {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  } else {
    await mongoose.disconnect();
    process.exit(0);
  }
});

startBackend().catch(async (error) => {
  console.error("NetEscalate startup failed:", error);
  if (server) {
    server.close();
  }
  try {
    await mongoose.disconnect();
  } catch (_) {
  }
  process.exit(1);
});
