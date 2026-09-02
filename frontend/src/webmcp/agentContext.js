// Tracks which tool GROUPS should be registered for the currently logged-in
// user - not an authority decision (the backend enforces that on every
// request regardless of what's registered here - see docs/WEBMCP.md), just
// which tools make sense to even offer an agent in this browser tab.
//
//   - A normal realm technician/manager: every tenant tool (deviceTools,
//     incidentTools, technicianTools, topologyTools).
//   - A platform admin with no Entered Realm: only platformTools
//     (list_realms/get_realm_overview) - the tenant tools would just 404 on
//     everything anyway (req.realmId is null server-side - see
//     attachRealmScope), so there's no reason to advertise them.
//   - A platform admin WHO HAS Entered a realm: both - they're now acting
//     as that realm's operator for tenant data, same as a normal user, on
//     top of their platform authority.
export function resolveToolGroups(user) {
  if (!user) return { tenant: false, platform: false };
  if (user.platformRole) return { tenant: Boolean(user.enteredRealm), platform: true };
  return { tenant: true, platform: false };
}

export default { resolveToolGroups };
