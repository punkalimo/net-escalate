import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const api = axios.create({ baseURL: `${API_URL}/api`, headers: { "Content-Type": "application/json" } });
api.interceptors.response.use(response => response, error => { console.error("API Error:", error.response?.data || error.message); return Promise.reject(error); });

export async function getIncidents() { return (await api.get("/incidents")).data; }
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
export async function getSimilarIncidents(incidentId) { return (await api.get(`/incidents/${incidentId}/similar-incidents`)).data; }
export async function getChangeCorrelation(incidentId) { return (await api.get(`/incidents/${incidentId}/change-correlation`)).data; }
export async function escalateIncident(incidentId) { return (await api.post(`/incidents/${incidentId}/escalate`)).data; }
export async function acknowledgeIncident(incidentId, note) { return (await api.post(`/incidents/${incidentId}/acknowledge`, note ? { note } : {})).data; }
export async function getDeviceHistory(incidentId) { return (await api.get(`/incidents/${incidentId}/device-history`)).data; }
export async function getTechnicians() { return (await api.get("/technicians")).data; }
export async function createTechnician(technician) { return (await api.post("/technicians", technician)).data; }
export async function updateTechnician(technicianId, technician) { return (await api.patch(`/technicians/${technicianId}`, technician)).data; }
export async function deleteTechnician(technicianId) { return (await api.delete(`/technicians/${technicianId}`)).data; }
export async function getTechnicianCapability(technicianId) { return (await api.get(`/technicians/${technicianId}/capability`)).data; }
export async function testTechnicianCall(technicianId, payload = {}) { return (await api.post(`/technicians/${technicianId}/test-call`, payload)).data; }
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
export async function getTopology() { return (await api.get("/topology")).data; }
export async function discoverTopology() { return (await api.post("/topology/discover")).data; }
export async function getDevicePath(deviceId) { return (await api.get(`/topology/devices/${deviceId}/path`)).data; }
export async function discoverDevicePath(deviceId) { return (await api.post(`/topology/devices/${deviceId}/path/discover`)).data; }
export default api;
