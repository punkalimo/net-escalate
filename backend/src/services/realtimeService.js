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

export default { emitToRealm };
