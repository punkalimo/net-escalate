import api from "./api";

export async function getRealms(params = {}) { return (await api.get("/platform/realms", { params })).data; }
export async function getRealm(realmId) { return (await api.get(`/platform/realms/${realmId}`)).data; }
export async function createRealm(realm) { return (await api.post("/platform/realms", realm)).data; }
export async function updateRealm(realmId, updates) { return (await api.patch(`/platform/realms/${realmId}`, updates)).data; }
export async function enterRealm(realmId, reason) { return (await api.post(`/platform/realms/${realmId}/enter`, reason ? { reason } : {})).data; }
export async function exitRealm() { return (await api.post("/platform/exit-realm")).data; }
export async function getPlatformOverview() { return (await api.get("/platform/overview")).data; }
export async function getPlatformTechnicians(params = {}) { return (await api.get("/platform/technicians", { params })).data; }
export async function getPlatformTechnician(id) { return (await api.get(`/platform/technicians/${id}`)).data; }
export async function updatePlatformTechnician(id, updates) { return (await api.patch(`/platform/technicians/${id}`, updates)).data; }
export async function setPlatformTechnicianCredentials(id, username, password) { return (await api.post(`/platform/technicians/${id}/credentials`, { username, password })).data; }
export async function getPlatformDevices(params = {}) { return (await api.get("/platform/devices", { params })).data; }
export async function getPlatformSites(params = {}) { return (await api.get("/platform/sites", { params })).data; }
export async function getPlatformIncidents(params = {}) { return (await api.get("/platform/incidents", { params })).data; }
export async function getPlatformAnalytics(days) { return (await api.get("/platform/analytics", { params: days ? { days } : {} })).data; }
export async function getAuditLog(params = {}) { return (await api.get("/platform/audit", { params })).data; }
