// Mirrors backend/src/middleware/authMiddleware.js's REALM_MANAGER_ROLES -
// keep these two lists in sync. A platform admin (platformRole set) also
// counts as a manager everywhere, same bypass the backend applies.
const REALM_MANAGER_ROLES = new Set(["realm_owner", "realm_admin", "noc_manager", "senior_engineer"]);

export function isRealmManager(user) {
  return Boolean(user?.platformRole) || REALM_MANAGER_ROLES.has(user?.realmRole);
}

export function canGrantRealmOwner(user) {
  return Boolean(user?.platformRole) || user?.realmRole === "realm_owner";
}
