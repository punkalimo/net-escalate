// Thin REST wrappers for the WebMCP tool surface (backend/src/routes/webmcpRoutes.js).
// Same shared `api` axios instance as every other services/*.js file - the
// httpOnly session cookie (and, server-side, req.realmId derived from it)
// rides along automatically, so a WebMCP tool call is authenticated and
// realm-scoped exactly like a normal dashboard request. See docs/WEBMCP.md.
import api from "./api";

export async function searchDevices({ query, status, type } = {}) { return (await api.get("/webmcp/devices", { params: { query, status, type } })).data; }
export async function getDeviceHealth(deviceId) { return (await api.get(`/webmcp/devices/${deviceId}/health`)).data; }
export async function getDeviceInterfaces(deviceId) { return (await api.get(`/webmcp/devices/${deviceId}/interfaces`)).data; }
export async function getInterfaceHealth(deviceId, ifIndex) { return (await api.get(`/webmcp/devices/${deviceId}/interfaces/${ifIndex}`)).data; }

export async function getActiveIncidents({ severity, device, limit } = {}) { return (await api.get("/webmcp/incidents", { params: { severity, device, limit } })).data; }
export async function getIncident(incidentId) { return (await api.get(`/webmcp/incidents/${incidentId}`)).data; }
export async function investigateIncident(incidentId) { return (await api.get(`/webmcp/incidents/${incidentId}/investigate`)).data; }

export async function getNetworkTopology(deviceId) { return (await api.get("/webmcp/topology", { params: deviceId ? { deviceId } : {} })).data; }

export async function findAvailableTechnicians({ skill, level } = {}) { return (await api.get("/webmcp/technicians", { params: { skill, level } })).data; }
export async function getTechnician(technicianId) { return (await api.get(`/webmcp/technicians/${technicianId}`)).data; }

export async function createIncidentTool(payload) { return (await api.post("/webmcp/incidents", { ...payload, approved: true })).data; }
export async function assignIncidentTool(incidentId, technicianId) { return (await api.post(`/webmcp/incidents/${incidentId}/assign`, { technicianId, approved: true })).data; }
export async function addIncidentNoteTool(incidentId, message) { return (await api.post(`/webmcp/incidents/${incidentId}/notes`, { message, approved: true })).data; }

export default {
  searchDevices, getDeviceHealth, getDeviceInterfaces, getInterfaceHealth,
  getActiveIncidents, getIncident, investigateIncident, getNetworkTopology,
  findAvailableTechnicians, getTechnician, createIncidentTool, assignIncidentTool, addIncidentNoteTool
};
