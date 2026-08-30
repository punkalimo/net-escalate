import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// A single shared connection for the whole session - NocDashboard's
// incident/device listeners and TeamChat's chat listener both attach to
// this SAME socket rather than each opening their own. A second io(...)
// call would double-connect and double-join the realm/technician rooms.
let socket = null;

export function getSocket() {
  if (!socket) socket = io(SOCKET_URL, { transports: ["websocket", "polling"], withCredentials: true });
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
