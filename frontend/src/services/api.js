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

export async function getIncidents() {
  const response = await api.get("/incidents");
  return response.data;
}

export async function getIncident(incidentId) {
  const response = await api.get(`/incidents/${incidentId}`);
  return response.data;
}

export async function createIncident(incident) {
  const response = await api.post("/incidents", incident);
  return response.data;
}

export async function resolveIncident(incidentId) {
  const response = await api.patch(`/incidents/${incidentId}/resolve`);
  return response.data;
}

export async function getTechnicians() {
  const response = await api.get("/technicians");
  return response.data;
}

export async function createTechnician(technician) {
  const response = await api.post("/technicians", technician);
  return response.data;
}

export async function getDevices() {
  const response = await api.get("/devices");
  return response.data;
}

export async function getDevice(deviceId) {
  const response = await api.get(`/devices/${deviceId}`);
  return response.data;
}

export async function createDevice(device) {
  const response = await api.post("/devices", device);
  return response.data;
}

export async function updateDevice(deviceId, device) {
  const response = await api.patch(`/devices/${deviceId}`, device);
  return response.data;
}

export async function deleteDevice(deviceId) {
  const response = await api.delete(`/devices/${deviceId}`);
  return response.data;
}

export async function testDevicePort(deviceId, port) {
  const response = await api.post(`/devices/${deviceId}/test-port`, { port });
  return response.data;
}

export async function testDeviceConnectivity(deviceId, port = 80) {
  const response = await api.post(`/devices/${deviceId}/test-connectivity`, { port });
  return response.data;
}

export async function testDeviceSnmp(deviceId) {
  const response = await api.post(`/devices/${deviceId}/test-snmp`);
  return response.data;
}

export async function discoverDeviceInterfaces(deviceId) {
  const response = await api.post(`/interfaces/${deviceId}/discover`);
  return response.data;
}

export async function getDeviceInterfaces(deviceId) {
  const response = await api.get(`/interfaces/${deviceId}`);
  return response.data;
}

export async function pollDevice(deviceId) {
  const response = await api.post(`/devices/${deviceId}/poll`);
  return response.data;
}

export default api;
