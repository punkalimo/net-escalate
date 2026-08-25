import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json" }
});

api.interceptors.response.use(
  response => response,
  error => {
    console.error("API Error:", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export async function getIncidents() { return (await api.get("/incidents")).data; }
export async function getIncident(incidentId) { return (await api.get(`/incidents/${incidentId}`)).data; }
export async function createIncident(incident) { return (await api.post("/incidents", incident)).data; }
export async function resolveIncident(incidentId) { return (await api.patch(`/incidents/${incidentId}/resolve`)).data; }
export async function getTechnicians() { return (await api.get("/technicians")).data; }
export async function createTechnician(technician) { return (await api.post("/technicians", technician)).data; }
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
export async function getInterfaceHistory(deviceId, ifIndex, hours = 24) {
  const params = { hours };
  if (ifIndex != null) params.ifIndex = ifIndex;
  return (await api.get(`/interfaces/${deviceId}/history`, { params })).data;
}
export default api;
