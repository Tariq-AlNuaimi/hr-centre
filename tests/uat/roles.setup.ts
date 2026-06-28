import { test as setup } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { prismaUnfiltered } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { discoverRoles, defaultLocale } from "./_discover";

// P2 (Build B) per-role auth setup — FULL mode only (wired as a dependency of the
// chromium-full run in playwright.config.ts; never runs in lean).
//
// For EACH role discovered from prisma/schema.prisma (except ADMIN, which reuses
// the admin.json saved by auth.setup.ts), this:
//   1. upserts a test user via prismaUnfiltered with a bcrypt hash + the role,
//   2. logs in through the UI, and
//   3. saves the storage state to uat-results/.auth/<role>.json
// so the permission-matrix spec (roles.full.uat.ts) can drive the app AS that role.
//
// Credentials come from env, never hardcoded:
//   email:    UAT_<ROLE>_EMAIL    (default "<role>@example.com")
//   password: UAT_<ROLE>_PASSWORD (default SEED_ADMIN_PASSWORD, the local seed pwd)
//
// The test users are idempotent FIXTURES — we leave them in the local test DB
// (the upsert below is the single source of truth, so re-running is safe). They
// are NEVER created against production: UAT runs against a local/preview DB only.
// To clean them up, delete the rows whose email matches `*@example.com` test
// addresses, or drop the local test DB.
//
// A role whose login fails (e.g. creds missing on a deployed-URL run where we
// can't reach the DB) is SKIPPED with a warning — it must not crash the suite.

// The privileged role is the FIRST member of the Role enum by convention (see
// _discover.ts), NOT a hardcoded "ADMIN" — this fork names it HR_ADMIN. It reuses
// admin.json from auth.setup.ts, so it must be excluded from the per-role
// provisioning below; hardcoding "ADMIN" wrongly provisioned HR_ADMIN as a second
// fixture user.
const ADMIN_ROLE = discoverRoles()[0] ?? "ADMIN";

// Against a deployed URL the test runner usually can't reach the DB to provision
// fixtures — and a Prisma connect attempt HANGS the whole setup timeout. So only
// DB-upsert role fixtures for LOCAL targets; for a remote URL the role users are
// expected to already exist (seeded / created by the operator) and we authenticate
// via the UI with the provided UAT_<ROLE>_EMAIL / UAT_<ROLE>_PASSWORD.
const UAT_TARGET = process.env.UAT_BASE_URL ?? "";
const isLocalTarget = UAT_TARGET === "" || /localhost|127\.0\.0\.1/.test(UAT_TARGET);

function authFileFor(role: string): string {
  return `uat-results/.auth/${role.toLowerCase()}.json`;
}

function emailFor(role: string): string {
  return (
    process.env[`UAT_${role}_EMAIL`] ?? `${role.toLowerCase()}@example.com`
  ).toLowerCase().trim();
}

function passwordFor(role: string): string | undefined {
  return process.env[`UAT_${role}_PASSWORD`] ?? process.env.SEED_ADMIN_PASSWORD;
}

// Defensive: a Prisma "invalid connection string" error can echo the full
// DATABASE_URL — which embeds the Neon credential (Confidential, SECURITY.md §1)
// — into the warning, and that warning lands in the shareable Playwright HTML
// report. Strip any `//user:password@` authority before logging.
function safeErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\/\/[^/@\s]*@/g, "//[credentials]@");
}

const roles = discoverRoles();

// Skip ADMIN: auth.setup.ts already logs the seeded admin in and saves admin.json.
const nonAdminRoles = roles.filter((r) => r !== ADMIN_ROLE);

setup("discovers non-admin roles", async () => {
  // Start each FULL run with clean report sinks so stale rows from a previous run
  // never leak into this run's PDF. roles.full.uat.ts and crud.full.uat.ts append
  // to these (the permission matrix and the per-entity CRUD journeys).
  for (const sink of [
    "role-matrix.json",
    "crud-journeys.json",
    "uiux-findings.json",
  ]) {
    try {
      fs.rmSync(path.join(process.cwd(), "uat-results", sink), { force: true });
    } catch {
      // Best-effort; a missing/locked file must not fail setup.
    }
  }

  // Soft guard: if discovery found no non-admin roles, there is nothing to set
  // up — the matrix will only have the admin column. Log it; do not fail (a fork
  // could legitimately have a single role).
  if (nonAdminRoles.length === 0) {
    console.warn(
      "roles.setup — no non-admin roles discovered from prisma/schema.prisma; " +
        "the permission matrix will cover ADMIN only.",
    );
  }
});

for (const role of nonAdminRoles) {
  setup(`provision + authenticate as ${role}`, async ({ page }) => {
    setup.setTimeout(120_000); // absorb first-hit dashboard cold-compile on dev
    const email = emailFor(role);
    const password = passwordFor(role);

    if (!password) {
      console.warn(
        `roles.setup — skipping ${role}: no password. Set UAT_${role}_PASSWORD ` +
          `(or SEED_ADMIN_PASSWORD) to include this role in the permission matrix.`,
      );
      setup.skip();
      return;
    }

    // 1) LOCAL targets only: provision the fixture user via the DB (idempotent).
    //    Skipped for remote URLs — a Prisma connect to an unreachable DB hangs the
    //    whole timeout; the role user must already exist there and we log in below.
    if (isLocalTarget) {
      try {
        const passwordHash = await hashPassword(password);
        await prismaUnfiltered.user.upsert({
          where: { email },
          update: { passwordHash, role: role as never, deletedAt: null },
          create: { email, name: `UAT ${role}`, passwordHash, role: role as never },
        });
      } catch (e) {
        console.warn(
          `roles.setup — ${role}: DB upsert failed ` +
            `(${safeErr(e)}); will try UI login. ` +
            `On a local carbon-copy this almost always means DATABASE_URL still ` +
            `points at the remote/unreachable DB — export the local DATABASE_URL ` +
            `to the uat:full command so this process can provision the fixture.`,
        );
      }
    }

    // 2) Log in through the UI (same flow as auth.setup.ts).
    try {
      await page.goto(`/${defaultLocale}/login`);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.locator('button[type="submit"]').click();
      // This fork's authenticated landing is /<locale>/app (not the bare locale
      // root), so accept either — else a manager who lands on /app is treated as a
      // failed login and the whole role is skipped, emptying its matrix column.
      await page.waitForURL(new RegExp(`/${defaultLocale}(/app)?/?$`), { timeout: 60_000 });
    } catch (e) {
      console.warn(
        `roles.setup — skipping ${role}: login did not land on the dashboard ` +
          `(${safeErr(e)}).`,
      );
      setup.skip();
      return;
    }

    // 3) Save the per-role session so the matrix spec can reuse it.
    await page.context().storageState({ path: authFileFor(role) });
  });
}
