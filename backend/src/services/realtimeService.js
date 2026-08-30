// Every real-time push (device_updated, incident_created, incident_updated,
// incident_correlation_updated) MUST go through here, never a bare
// global.io.emit(...) - that would broadcast to every connected socket
// regardless of realm, a real cross-tenant leak even though the REST API
// itself is correctly scoped (sockets join a realm-keyed room at connect
// time - see server.js - so .to(realmId) is what actually confines this).
export function emitToRealm(realmId, event, payload) {
  if (!global.io || !realmId) return;
  global.io.to(String(realmId)).emit(event, payload);
}

// A technician's own private room (joined at connect time in server.js,
// alongside their realm room) - the only sanctioned path for anything that
// must reach ONE person rather than everyone in a realm, e.g. a DM. Never
// use emitToRealm for that: it would hand the private payload to every
// socket in the realm room even if the UI chooses not to render it there.
export function emitToTechnician(technicianId, event, payload) {
  if (!global.io || !technicianId) return;
  global.io.to(`tech:${technicianId}`).emit(event, payload);
}

export default { emitToRealm, emitToTechnician };
