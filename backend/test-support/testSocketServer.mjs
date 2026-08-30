// Mirrors server.js's Socket.IO wiring (auth + realm-room join) in
// isolation, for testing realtimeService.js's emitToRealm without importing
// server.js itself (which has connect/listen side effects - see testApp.mjs's
// comment for the same reasoning).
import { createServer } from "http";
import { Server } from "socket.io";
import { parseCookie } from "cookie";
import { verifyAuthToken, AUTH_COOKIE_NAME, verifyRealmContext, REALM_CONTEXT_COOKIE_NAME } from "../src/services/authService.js";

export function startTestSocketServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  global.io = io;

  io.use((socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || "");
      const user = verifyAuthToken(cookies[AUTH_COOKIE_NAME]);
      socket.user = user;
      socket.technicianId = user.technicianId || null;
      if (user.platformRole) {
        try { socket.realmId = verifyRealmContext(cookies[REALM_CONTEXT_COOKIE_NAME]).realmId; }
        catch { socket.realmId = null; }
      } else {
        socket.realmId = user.realmId || null;
      }
      return next();
    } catch (error) {
      return next(new Error("unauthorized"));
    }
  });
  io.on("connection", socket => {
    if (socket.realmId) socket.join(String(socket.realmId));
    if (socket.technicianId) socket.join(`tech:${socket.technicianId}`);
  });

  return new Promise(resolve => {
    httpServer.listen(0, () => resolve({ httpServer, io, port: httpServer.address().port }));
  });
}

export async function stopTestSocketServer({ httpServer, io }) {
  io.close();
  await new Promise(resolve => httpServer.close(resolve));
  delete global.io;
}
