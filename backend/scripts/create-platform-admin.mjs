// One-off CLI to create a Platform Super Admin - a Technician-like account
// with realmId: null and platformRole set, operating across every realm
// rather than belonging to one. Mirrors create-admin.mjs's pattern; kept as
// a separate script rather than an extra flag on that one so the two
// account kinds (realm technician vs. platform operator) stay obviously
// distinct at the point of creation.
//
// Usage:
//   node scripts/create-platform-admin.mjs --username <u> --password <p> --name "<name>" [--role platform_super_admin|platform_support|platform_analyst]

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

const VALID_PLATFORM_ROLES = ["platform_super_admin", "platform_support", "platform_analyst"];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = String(args.username || "").trim().toLowerCase();
  const password = String(args.password || "");
  const name = String(args.name || "").trim();
  const platformRole = args.role || "platform_super_admin";

  if (!username || !password || !name || !VALID_PLATFORM_ROLES.includes(platformRole)) {
    console.error(`Usage: node scripts/create-platform-admin.mjs --username <u> --password <p> --name "<name>" [--role ${VALID_PLATFORM_ROLES.join("|")}]`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const passwordHash = await hashPassword(password);
  const existing = await Technician.findOne({ username });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.name = name;
    existing.platformRole = platformRole;
    existing.realmId = null;
    existing.active = true;
    await existing.save();
    console.log(`Updated platform admin "${username}" (${existing.technicianId}), role ${platformRole}.`);
  } else {
    const technicianId = `PLATFORM-${Date.now().toString(36).toUpperCase()}`;
    await Technician.create({ technicianId, username, passwordHash, name, realmId: null, platformRole, active: true, role: "Platform Administrator" });
    console.log(`Created platform admin "${username}" (${technicianId}), role ${platformRole}.`);
  }

  await mongoose.disconnect();
}

main().catch(error => {
  console.error("create-platform-admin failed:", error);
  process.exit(1);
});
