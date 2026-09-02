import axios from "axios";

// Production frontend is hosted by Render. Use the deployed API service in
// production so the browser never falls back to localhost:5000.
const DEFAULT_API_URL = "https://net-escalate.onrender.com";
export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;
// withCredentials so the httpOnly session cookie set by /auth/login is sent
// on every request - see backend/src/server.js's CORS config, which must
// use an explicit origin (not "*") for this to work.
const api = axios.create({ baseURL: `${API_URL}/api`, headers: { "Content-Type": "application/json" }, withCredentials: true });
api.interceptors.response.use(response => response, error => {
  console.error("API Error:", error.response?.data || error.message);
  // A 401 on anything other than the login call itself means the session
  // expired or was revoked mid-session - tell App.jsx to drop back to the
  // login screen instead of leaving every open component silently failing.
  if (error.response?.status === 401 && !error.config?.url?.endsWith("/auth/login")) {
    window.dispatchEvent(new CustomEvent("netescalate:unauthenticated"));
  }
  return Promise.reject(error);
});

export async function login(username, password) { return (await api.post("/auth/login", { username, password })).data; }
export async function logout() { return (await api.post("/auth/logout")).data; }
export async function getMe() { return (await api.get("/auth/me")).data; }
export async function updateMyProfile(updates) { return (await api.patch("/auth/me", updates)).data; }
export async function updateMyCredentials(payload) { return (await api.post("/auth/me/credentials", payload)).data; }

export async function getIncidents() { return (await api.get("/incidents")).data; }
export async function getIncidentOverview() { return (await api.get("/incidents/overview")).data; }
export async function getIncident(incidentId) { return (await api.get(`/incidents/${incidentId}`)).data; }
export async function createIncident(incident) { return (await api.post("/incidents", incident)).data; }
export async function resolveIncident(incidentId, resolutionNotes) { return (await api.patch(`/incidents/${incidentId}/resolve`, resolutionNotes ? { resolutionNotes } : {})).data; }
export async function getIncidentCorrelation(refresh = false) { return (await api.get(`/incidents/correlation${refresh ? "?refresh=true" : ""}`)).data; }
export async function rebuildIncidentCorrelation() { return (await api.post("/incidents/correlation/rebuild")).data; }
export async function mergeIncident(incidentId, intoIncidentId) { return (await api.post(`/incidents/${incidentId}/merge`, { intoIncidentId })).data; }
export async function unmergeIncident(incidentId) { return (await api.post(`/incidents/${incidentId}/unmerge`)).data; }
export async function getIncidentRootCause(incidentId) { return (await api.get(`/incidents/${incidentId}/root-cause`)).data; }
export async function getIncidentBlastRadius(incidentId) { return (await api.get(`/incidents/${incidentId}/blast-radius`)).data; }
export async function addIncidentComment(incidentId, message, actor) { return (await api.post(`/incidents/${incidentId}/comment`, { message, actor })).data; }
export async function getIncidentSla(incidentId) { return (await api.get(`/incidents/${incidentId}/sla`)).data; }
export async function getIncidentRecommendedActions(incidentId) { return (await api.get(`/incidents/${incidentId}/recommended-actions`)).data; }
export async function getRemediationCatalog(incidentId) { return (await api.get(`/incidents/${incidentId}/remediation-catalog`)).data; }
export async function proposeRemediation(incidentId, action) { return (await api.post(`/incidents/${incidentId}/remediation`, action)).data; }
export async function approveRemediation(incidentId, actionId) { return (await api.post(`/incidents/${incidentId}/remediation/${actionId}/approve`)).data; }
export async function rejectRemediation(incidentId, actionId, reason) { return (await api.post(`/incidents/${incidentId}/remediation/${actionId}/reject`, reason ? { reason } : {})).data; }
export async function executeRemediation(incidentId, actionId) { return (await api.post(`/incidents/${incidentId}/remediation/${actionId}/execute`)).data; }
export async function getSimilarIncidents(incidentId) { return (await api.get(`/incidents/${incidentId}/similar-incidents`)).data; }
export async function getChangeCorrelation(incidentId) { return (await api.get(`/incidents/${incidentId}/change-correlation`)).data; }
export async function escalateIncident(incidentId) { return (await api.post(`/incidents/${incidentId}/escalate`)).data; }
export async function acknowledgeIncident(incidentId, note) { return (await api.post(`/incidents/${incidentId}/acknowledge`, note ? { note } : {})).data; }
export async function getDeviceHistory(incidentId) { return (await api.get(`/incidents/${incidentId}/device-history`)).data; }
export async function askAssistant(question, incidentId) { return (await api.post(`/phase4/assistant`, incidentId ? { question, incidentId } : { question })).data; }
export async function getTechnicians() { return (await api.get("/technicians")).data; }
export async function createTechnician(technician) { return (await api.post("/technicians", technician)).data; }
export async function updateTechnician(technicianId, technician) { return (await api.patch(`/technicians/${technicianId}`, technician)).data; }
export async function deleteTechnician(technicianId) { return (await api.delete(`/technicians/${technicianId}`)).data; }
export async function getTechnicianCapability(technicianId) { return (await api.get(`/technicians/${technicianId}/capability`)).data; }
export async function setTechnicianCredentials(technicianId, username, password) { return (await api.post(`/technicians/${technicianId}/credentials`, { username, password })).data; }
export async function updateTechnicianRole(technicianId, realmRole) { return (await api.patch(`/technicians/${technicianId}/role`, { realmRole })).data; }
export async function getTechnicianPerformance() { return (await api.get("/technicians/performance")).data; }
export async function testTechnicianCall(technicianId, payload = {}) { return (await api.post(`/technicians/${technicianId}/test-call`, payload)).data; }
export async function getSites() { return (await api.get("/sites")).data; }
export async function getSite(siteId) { return (await api.get(`/sites/${siteId}`)).data; }
export async function createSite(site) { return (await api.post("/sites", site)).data; }
export async function updateSite(siteId, updates) { return (await api.patch(`/sites/${siteId}`, updates)).data; }
export async function deleteSite(siteId) { return (await api.delete(`/sites/${siteId}`)).data; }
export async function getDevices() { return (await api.get("/devices")).data; }
export async function getDevice(deviceId) { return (await api.get(`/devices/${deviceId}`)).data; }
export async function createDevice(device) { return (await api.post("/devices", device)).data; }
export async function updateDevice(deviceId, device) { return (await api.patch(`/devices/${deviceId}`, device)).data; }
export async function deleteDevice(deviceId) { return (await api.delete(`/devices/${deviceId}`)).data; }
export async function testDevicePort(deviceId, port) { return (await api.post(`/devices/${deviceId}/test-port`, { port })).data; }
export async function testDeviceConnectivity(deviceId, port = 80) { return (await api.post(`/devices/${deviceId}/test-connectivity`, { port })).data; }
export async function testDeviceSnmp(deviceId) { return (await api.post(`/devices/${deviceId}/test-snmp`)).data; }
export async function pollDevice(deviceId) { return (await api.post(`/devices/${deviceId}/poll`)).data; }
export async function discoverDeviceInterfaces(deviceId) { return (await api.post(`/interfaces/${deviceId}/discover`)).data; }
export async function getDeviceInterfaces(deviceId) { return (await api.get(`/interfaces/${deviceId}`)).data; }
export async function getInterfaceHistory(deviceId, ifIndex, hours = 24) { const params = { hours }; if (ifIndex != null) params.ifIndex = ifIndex; return (await api.get(`/interfaces/${deviceId}/history`, { params })).data; }
export async function setInterfaceMonitored(deviceId, ifIndex, monitored) { return (await api.patch(`/interfaces/${deviceId}/${ifIndex}/monitored`, { monitored })).data; }
export async function getSystemHealthHistory(deviceId, metric, hours = 24) { const params = { hours }; if (metric) params.metric = metric; return (await api.get(`/devices/${deviceId}/system-health/history`, { params })).data; }
export async function getTeamMessages(before) { return (await api.get("/messages/team", { params: before ? { before } : {} })).data; }
// Content-Type explicitly unset so the browser fills in the multipart
// boundary itself - the shared `api` instance's default JSON content-type
// header would otherwise override it and break multer's parsing server-side.
export async function postTeamMessage({ text, attachment }) { const form = new FormData(); form.append("text", text || ""); if (attachment) form.append("attachment", attachment); return (await api.post("/messages/team", form, { headers: { "Content-Type": undefined } })).data; }
export async function getConversations() { return (await api.get("/messages/conversations")).data; }
export async function getDmMessages(technicianId, before) { return (await api.get(`/messages/dm/${technicianId}`, { params: before ? { before } : {} })).data; }
export async function postDmMessage(technicianId, { text, attachment }) { const form = new FormData(); form.append("text", text || ""); if (attachment) form.append("attachment", attachment); return (await api.post(`/messages/dm/${technicianId}`, form, { headers: { "Content-Type": undefined } })).data; }
export function attachmentUrl(messageId) { return `${API_URL}/api/messages/attachments/${messageId}`; }

export async function getTopology() { return (await api.get("/topology")).data; }
export async function discoverTopology() { return (await api.post("/topology/discover")).data; }
export async function getDevicePath(deviceId) { return (await api.get(`/topology/devices/${deviceId}/path`)).data; }
export async function discoverDevicePath(deviceId) { return (await api.post(`/topology/devices/${deviceId}/path/discover`)).data; }
export default api;
