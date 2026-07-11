#!/usr/bin/env node
// manual-uat-users.mjs — Ensure one login per role exists so the manual UAT
// (.claude/skills/manual-uat) can sign in AS each role and walk its journeys.
//
// The template only seeds an ADMIN (prisma/seed.ts). This idempotently upserts a
// test user for every NON-ADMIN role in the `Role` enum, using the same bcrypt
// hashing as the seed. Credentials come from env, never hardcoded:
//   email:    UAT_<ROLE>_EMAIL    (default "<role>@example.com")
//   password: UAT_<ROLE>_PASSWORD (falls back to SEED_ADMIN_PASSWORD)
//
// It mirrors tests/uat/roles.setup.ts but runs standalone (no Playwright), so the
// agent driving a live browser via the Playwright MCP can provision first, then
// log in by hand. It prints the emails + which env var holds each password — it
// NEVER prints the passwords themselves (they are Restricted; SECURITY.md §1).
//
// LOCAL/TEST DB ONLY. It refuses to run in production. Run: `npm run manual-uat:users`.

import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../lib/password";

const ROOT = process.cwd();

function discoverRoles() {
  const schemaPath = path.join(ROOT, "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) return [];
  const src = fs.readFileSync(schemaPath, "utf8");
  const block = src.match(/enum\s+Role\s*\{([^}]*)\}/);
  if (!block) return [];
  return block[1]
    .split("\n")
    .map(
      (l) =>
        l
          .replace(/\/\/.*$/, "")
          .trim()
          .match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1],
    )
    .filter(Boolean);
}

function emailFor(role) {
  return (process.env[`UAT_${role}_EMAIL`] ?? `${role.toLowerCase()}@example.com`)
    .toLowerCase()
    .trim();
}

function passwordEnvFor(role) {
  if (process.env[`UAT_${role}_PASSWORD`]) return `UAT_${role}_PASSWORD`;
  if (process.env.SEED_ADMIN_PASSWORD) return "SEED_ADMIN_PASSWORD";
  return null;
}

function passwordFor(role) {
  return process.env[`UAT_${role}_PASSWORD`] ?? process.env.SEED_ADMIN_PASSWORD;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refusing to provision UAT role users in production. This is a local/test-DB helper.",
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is unset — start the dev DB (`make db-up`) and try again.");
    process.exit(1);
  }
  // NODE_ENV alone is not enough: it is unset in many CI/self-hosted shells, and a
  // local NODE_ENV=development can still point DATABASE_URL at a remote/prod branch
  // (a common incident-triage mistake). Refuse a non-local DB unless explicitly
  // opted in, so this writer never silently provisions users into a shared DB.
  const isLocalDb = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.DATABASE_URL);
  if (!isLocalDb && process.env.UAT_ALLOW_REMOTE !== "1") {
    console.error(
      "DATABASE_URL does not look local. This helper writes User rows — refusing a\n" +
        "non-local DB. Set UAT_ALLOW_REMOTE=1 to override (only for a throwaway test/preview DB).",
    );
    process.exit(1);
  }

  const roles = discoverRoles();
  const nonAdmin = roles.filter((r) => r !== "ADMIN");
  if (nonAdmin.length === 0) {
    console.log("No non-admin roles in the Role enum — nothing to provision.");
    return;
  }

  // Bare PrismaClient by design: this standalone UAT helper (no `@/` alias, no app
  // runtime) deliberately bypasses the audit + soft-delete extensions in lib/prisma/.
  // Provisioning throwaway test logins is UAT scaffolding, not an audited domain
  // mutation, and it runs only against a local/test DB (guarded above) — so audit
  // coverage of the UAT user lifecycle is intentionally out of scope.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const summary = [];
  try {
    for (const role of nonAdmin) {
      const email = emailFor(role);
      const pwEnv = passwordEnvFor(role);
      const password = passwordFor(role);
      if (!password) {
        summary.push({
          role,
          email,
          status: "SKIPPED — set UAT_" + role + "_PASSWORD or SEED_ADMIN_PASSWORD",
        });
        continue;
      }
      const passwordHash = await hashPassword(password);
      await prisma.user.upsert({
        where: { email },
        update: { passwordHash, role, deletedAt: null },
        create: { email, name: `UAT ${role}`, passwordHash, role },
      });
      summary.push({ role, email, status: "ready", passwordFrom: pwEnv });
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("\nMANUAL UAT — role logins\n" + "=".repeat(48));
  for (const s of summary) {
    if (s.status === "ready") {
      console.log(`  ${s.role.padEnd(8)} ${s.email}   (password from $${s.passwordFrom})`);
    } else {
      console.log(`  ${s.role.padEnd(8)} ${s.email}   ${s.status}`);
    }
  }
  console.log("\nAdmin login is the seeded SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.\n");
}

main().catch((e) => {
  // A Prisma connection error can carry the DATABASE_URL (incl. credentials) in
  // its message — Restricted (SECURITY.md §1). Surface only the first line and
  // redact any embedded connection string before logging.
  const raw = e instanceof Error ? e.message.split("\n")[0] : String(e);
  const safe = raw.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[redacted]@");
  console.error("manual-uat-users failed:", safe);
  process.exit(1);
});
