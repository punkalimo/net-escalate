import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h - matches the cookie maxAge set on login.
export const AUTH_COOKIE_NAME = "netescalate_token";
export const AUTH_COOKIE_MAX_AGE_MS = TOKEN_TTL_SECONDS * 1000;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not configured. Set it in backend/.env before starting the server.");
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

// Payload deliberately excludes phone/passwordHash - only what routes/UI
// need to identify and authorize the caller.
export function signAuthToken(technician) {
  return jwt.sign(
    { technicianId: technician.technicianId, username: technician.username, name: technician.name, role: technician.role, level: technician.level },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

export function verifyAuthToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export default { hashPassword, verifyPassword, signAuthToken, verifyAuthToken, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS };
