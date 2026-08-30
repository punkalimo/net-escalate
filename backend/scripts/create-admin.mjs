// One-off CLI to create or update login credentials for a Technician.
// Deliberately not an HTTP endpoint: this app has no open self-registration,
// so this script is the only way to provision the first login.
//
// Usage:
//   node scripts/create-admin.mjs --username admin --password "..." --name "NOC Admin" --level 3 [--role "Senior Network Engineer"] [--phone "+2600000000"]
//
// Re-running with an existing --username updates that technician's password
// instead of creating a duplicate.

import "dotenv/config";
import mongoose from "mongoose";
import Technician from "../src/models/Technician.js";
import { hashPassword } from "../src/services/authService.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = String(args.username || "").trim().toLowerCase();
  const password = String(args.password || "");
  const name = String(args.name || "").trim();
  const level = Number(args.level);

  if (!username || !password || !name || !Number.isInteger(level) || level < 1) {
    console.error("Usage: node scripts/create-admin.mjs --username <u> --password <p> --name \"<name>\" --level <1-3> [--role \"<role>\"] [--phone \"<phone>\"]");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const passwordHash = await hashPassword(password);
  const existing = await Technician.findOne({ username });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.name = name;
    existing.level = level;
    if (args.role) existing.role = args.role;
    if (args.phone) existing.phone = args.phone;
    existing.active = true;
    await existing.save();
    console.log(`Updated login credentials for existing technician "${username}" (${existing.technicianId}).`);
  } else {
    const technicianId = `TECH-${Date.now().toString(36).toUpperCase()}`;
    await Technician.create({
      technicianId,
      username,
      passwordHash,
      name,
      phone: args.phone || "+10000000000",
      level,
      role: args.role || "Network Engineer",
      active: true
    });
    console.log(`Created technician "${username}" (${technicianId}) with login access.`);
  }

  await mongoose.disconnect();
}

main().catch(error => {
  console.error("create-admin failed:", error);
  process.exit(1);
});
