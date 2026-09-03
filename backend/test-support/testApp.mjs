// Builds an Express app with the same route/middleware wiring as
// src/server.js, for HTTP-level testing via supertest against an in-memory
// MongoDB - without importing server.js itself, which connects to the real
// configured MONGODB_URI and calls httpServer.listen() as import-time side
// effects. Deliberately omits socket.io and the background monitoring
// sweeps (startAllDeviceMonitoring/interval sweeps) - tests want a plain,
// synchronous-per-request API surface, not live SNMP polling.

import express from "express";
import cookieParser from "cookie-parser";
import authRoutes from "../src/routes/authRoutes.js";
import incidentRoutes from "../src/routes/incidentRoutes.js";
import technicianRoutes from "../src/routes/technicianRoutes.js";
import deviceRoutes from "../src/routes/deviceRoutes.js";
import siteRoutes from "../src/routes/siteRoutes.js";
import messageRoutes from "../src/routes/messageRoutes.js";
import platformRoutes from "../src/routes/platformRoutes.js";
import webmcpRoutes from "../src/routes/webmcpRoutes.js";
import oauthRoutes, { wellKnownRoutes } from "../src/routes/oauthRoutes.js";
import mcpRoutes from "../src/routes/mcpRoutes.js";
import { requireAuth, requirePlatform, attachRealmScope } from "../src/middleware/authMiddleware.js";

export function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (req, res) => res.json({ status: "healthy" }));
  app.use("/api/auth", authRoutes());
  app.use("/api", requireAuth);
  app.use("/api/platform", requirePlatform, platformRoutes());
  app.use("/api", attachRealmScope);
  app.use("/api/incidents", incidentRoutes(null));
  app.use("/api/technicians", technicianRoutes);
  app.use("/api/devices", deviceRoutes);
  app.use("/api/sites", siteRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/webmcp", webmcpRoutes(null));
  // No rate limiting here (production-only, see server.js) - a test suite
  // legitimately makes many more requests per minute than a real client.
  app.use("/.well-known", wellKnownRoutes());
  app.use("/oauth", oauthRoutes());
  app.use("/mcp", mcpRoutes());
  return app;
}
