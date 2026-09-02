import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Response headers WebMCP itself cares about - these have to live on the
// document (HTML) response the browser navigates to, not on the backend
// API's JSON responses, since document.modelContext's access checks
// (@mcp-b/webmcp-polyfill's validateWebMcpAccess()) read the *page's own*
// Permissions-Policy/Origin-Agent-Cluster state, not anything from a
// same-origin XHR/fetch. Setting them here (dev + `vite preview`) is the
// part of "production WebMCP headers" this repo can actually own; whichever
// static host serves the built frontend in production (nginx, a CDN, a PaaS)
// must be configured to send the same two headers on its HTML response -
// see docs/WEBMCP.md's production headers section.
const WEBMCP_HEADERS = {
  // Explicitly opt this origin's document into WebMCP for itself only.
  // @mcp-b/webmcp-polyfill throws NotAllowedError from registerTool() if a
  // Permissions-Policy is present and declares "tools" without allowing it -
  // declaring `(self)` here is what makes that check pass, and it also
  // means an <iframe> embedding this app from another origin can never get
  // document.modelContext access, closing off a cross-origin page silently
  // driving WebMCP tools in a logged-in NOC engineer's tab.
  "Permissions-Policy": "tools=(self)",
  // Requests origin-keyed agent clustering, which the WebMCP polyfill's own
  // validateOriginAgentCluster() defensively checks for.
  "Origin-Agent-Cluster": "?1",
  // Same motivation as the Permissions-Policy line above, belt-and-braces:
  // NetEscalate is never meant to be framed by another origin at all.
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'self'"
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: { headers: WEBMCP_HEADERS },
  preview: { headers: WEBMCP_HEADERS }
});