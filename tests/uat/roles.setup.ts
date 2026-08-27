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

const ADMIN_ROLE = "ADMIN";

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
  return (process.env[`UAT_${role}_EMAIL`] ?? `${role.toLowerCase()}@example.com`)
    .toLowerCase()
    .trim();
}

function passwordFor(role: string): string | undefined {
  return process.env[`UAT_${role}_PASSWORD`] ?? process.env.SEED_ADMIN_PASSWORD;
}

/**
 * The §4.1 facts about a fixture login that decide whether it may reach a
 * capability-gated section. Written next to the storage state, read by
 * roles.full.uat.ts. Absent (or `linked: false`) means "no employee record", the
 * ordinary state for a login the harness itself provisioned.
 */
export type FixtureActor = { linked: boolean; pmsRoles: string[]; isLineManager: boolean };

function actorFileFor(role: string): string {
  return `uat-results/.auth/${role.toLowerCase()}.actor.json`;
}

async function saveActor(role: string, email: string): Promise<void> {
  let actor: FixtureActor = { linked: false, pmsRoles: [], isLineManager: false };
  try {
    const user = await prismaUnfiltered.user.findUnique({
      where: { email },
      select: { employee: { select: { id: true, pmsRoles: true } } },
    });
    const emp = user?.employee ?? null;
    if (emp) {
      // Line-manager authority is DERIVED from the org tree, never assigned
      // (§4.2), so it is counted rather than read off a field.
      const reports = await prismaUnfiltered.employee.count({ where: { managerId: emp.id } });
      actor = { linked: true, pmsRoles: emp.pmsRoles as string[], isLineManager: reports > 0 };
    }
  } catch (e) {
    // Never fail the run over this: the matrix treats a missing actor file as
    // "no employee record", which is the conservative reading.
    console.warn(
      `roles.setup — ${role}: could not resolve the fixture's employee record ` +
        `(${e instanceof Error ? e.message : String(e)}); the matrix will assume none.`,
    );
  }
  const file = path.join(process.cwd(), actorFileFor(role));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(actor, null, 2));
}

const roles = discoverRoles();

// Skip ADMIN: auth.setup.ts already logs the seeded admin in and saves admin.json.
const nonAdminRoles = roles.filter((r) => r !== ADMIN_ROLE);

setup("discovers non-admin roles", async () => {
  // Start each FULL run with clean report sinks so stale rows from a previous run
  // never leak into this run's PDF. roles.full.uat.ts and crud.full.uat.ts append
  // to these (the permission matrix and the per-entity CRUD journeys).
  for (const sink of ["role-matrix.json", "crud-journeys.json", "uiux-findings.json"]) {
    try {
      fs.rmSync(path.join(process.cwd(), "uat-results", sink), { force: true });
    } catch {
      // Best-effort; a missing/locked file must not fail setup.
    }
  }

  // ADMIN's storage state comes from auth.setup.ts, but its §4.1 identity still
  // has to be resolved — and it is the one fixture the harness does NOT control,
  // so it is also the one most likely to be linked to an employee (an operator
  // signing in as themselves). Without this, ADMIN's capability-gated rows were
  // the only ones the matrix could not decide.
  if (isLocalTarget) {
    const adminEmail = (process.env.UAT_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "")
      .toLowerCase()
      .trim();
    if (adminEmail) await saveActor(ADMIN_ROLE, adminEmail);
    else
      console.warn("roles.setup — no UAT_EMAIL/SEED_ADMIN_EMAIL; ADMIN's §4.1 identity unknown.");
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
            `(${e instanceof Error ? e.message : String(e)}); will try UI login.`,
        );
      }
    }

    // 2) Log in through the UI (same flow as auth.setup.ts).
    try {
      await page.goto(`/${defaultLocale}/login`);
      // Select by field name, not id — the shadcn FormControl id is a generated
      // useId(), not "email" (mirrors auth.setup.ts post-C2/C3). Without this the
      // per-role login silently times out and the whole permission matrix skips.
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(new RegExp(`/${defaultLocale}/?$`), { timeout: 60_000 });
    } catch (e) {
      console.warn(
        `roles.setup — skipping ${role}: login did not land on the dashboard ` +
          `(${e instanceof Error ? e.message : String(e)}).`,
      );
      setup.skip();
      return;
    }

    // 3) Save the per-role session so the matrix spec can reuse it.
    await page.context().storageState({ path: authFileFor(role) });

    // 4) Save the fixture's §4.1 IDENTITY alongside it.
    //
    // The matrix used to predict reachability from the platform role alone, and
    // for a §4.1-gated section that is not decidable: the answer depends on the
    // fixture's `Employee` record (ADR-065's second axis), which the filesystem
    // cannot be asked about. Resolving it HERE — where a DB connection already
    // exists for local targets — is what lets roles.full.uat.ts assert those rows
    // instead of recording them unasserted.
    if (isLocalTarget) await saveActor(role, email);
  });
}
