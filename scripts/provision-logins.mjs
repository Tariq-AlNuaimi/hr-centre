#!/usr/bin/env node
// provision-logins.mjs — give existing employees the login ADR-069 says they should have.
//
// WHY THIS EXISTS. Applying an employee import provisions a login for every employee it
// creates, and `prisma/seed-pms.ts` does the same for the fixture. Neither helps a database
// that was SEEDED BEFORE that behaviour existed — production is exactly that: 37 employees,
// none with a `User` row. The alternatives were both worse than a narrow script:
//
//   - Re-running the full seed rewrites every employee row and needs SALARY_ENCRYPTION_KEY
//     (ADR-067) to re-encrypt pay. Enormous blast radius to fix a missing FK.
//   - Creating 37 accounts by hand at /admin/access/new is an afternoon and a typo away from a
//     duplicate-email refusal.
//
// This touches TWO things and nothing else: it inserts `users` rows, and it sets
// `employees.userId`. It never writes a password, never changes a role, never touches an
// employee's org data.
//
// The rules are ADR-069's, restated so this file can be read on its own:
//   - PASSWORDLESS. `authorize()` returns null without a hash, so these accounts cannot be
//     signed into with a guessed password. They become usable when an IdP is configured.
//   - `VIEWER`. Appearing in an HR directory never mints a platform administrator; §4.1
//     authority lives on role assignments and is granted at /admin/roles by a human.
//   - LEAVERs are skipped. §12.1 preserves a leaver's record, not their access.
//   - Idempotent, and never destructive. An employee who already has `userId` is skipped;
//     an email that already has a `User` — live OR soft-deleted — is skipped and NOT
//     re-linked, because a soft-deleted account is access somebody deliberately revoked.
//
// DRY RUN BY DEFAULT. It prints what it would do and writes nothing until `--apply`.
//
// A SECOND, separate mode gives the demo cast a way to actually sign in
// (docs/demo/DEMO-CAST.md). Passwords come from per-person environment variables and
// are never generated, printed or defaulted here — see `--demo-cast` below.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/provision-logins.mjs               # dry run
//   DATABASE_URL=... npx tsx scripts/provision-logins.mjs --apply       # provision logins
//   DATABASE_URL=... npx tsx scripts/provision-logins.mjs --demo-cast   # dry run, cast only
//   DATABASE_URL=... npx tsx scripts/provision-logins.mjs --demo-cast --apply
//
// Build-vs-buy: docs/build-vs-buy-ledger.md.

import { prisma, auditedTransaction } from "../lib/prisma";
import { withAuditContext } from "../lib/audit-context";
import { hashPassword } from "../lib/password";

const APPLY = process.argv.includes("--apply");
const DEMO_CAST = process.argv.includes("--demo-cast");

/**
 * The five people docs/demo/DEMO-CAST.md puts on stage, each because a DIFFERENT clause
 * needs a different pair of eyes. Keyed by Odoo id, which is §3.2's permanent key — a
 * rename or an email change must not silently move the demo onto the wrong person.
 *
 * The password for each comes from `DEMO_PASSWORD_<odooId>` in the environment. It is
 * never generated here and never printed: a password this script invented would have to
 * be transmitted somehow, and every way of doing that is worse than the operator choosing
 * five and exporting them.
 */
const DEMO_CAST_ODOO_IDS = {
  1100: "Fatma Al-Rashdi — HR Super Admin: §5.1's approval, §10 calibration, §13.2's publish",
  1202: "Layla Al-Habsi — line manager: §5.2's KPI texts, §7's manager rating, a 360 rater",
  1203: "Omar Al-Busaidi — employee: §5.3's sign, §7's self-assessment, §13.2's publish gate",
  1200: "Tariq Al-Naaimi — director: §9.7's 360, filled in live from an unanswered assignment",
  1101: "Yousuf Al-Amri — HRBP: §4.1's hardest line, refused calibration with org-wide sight",
};
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set. Export it (never paste it into a shell history).");
  process.exit(1);
}

// The APP's client, extensions and all, rather than a bare `PrismaClient`. Creating
// thirty-seven accounts is exactly the kind of write Appendix A means by "audit everything
// sensitive", and a maintenance script that writes them untraced would be the one bulk
// account creation in the product with no trail. `deletedBy` / `userId` land as null,
// which is the honest record for a run with no session behind it — the same attribution
// `withInternalAuth`'s cron routes produce.
//
// The cost is that reads are soft-delete filtered, so the taken-email lookup below has to
// ask its question twice. That is the trade the floor rule (`no-bare-prisma-transaction`)
// is pointing at, and it is the right one.

async function main() {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, userId: null, status: { not: "LEAVER" } },
    select: { id: true, name: true, email: true, odooId: true },
    orderBy: { odooId: "asc" },
  });

  if (employees.length === 0) {
    console.log("Nothing to do: every active employee already has a login.");
    return;
  }

  // One query for every email in play, rather than one per employee.
  const emails = employees.map((e) => e.email.toLowerCase().trim());
  // TWO reads: the audited client injects `deletedAt: null` unless the caller names the
  // column, and the unique email index does not respect that filter. Missing a
  // soft-deleted account would mean a `create` that collides and aborts the run.
  const [live, revoked] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    prisma.user.findMany({
      where: { email: { in: emails }, deletedAt: { not: null } },
      select: { email: true },
    }),
  ]);
  const taken = new Set([...live, ...revoked].map((u) => u.email.toLowerCase()));

  const toProvision = employees.filter((e) => !taken.has(e.email.toLowerCase().trim()));
  const skipped = employees.length - toProvision.length;

  console.log(
    `${employees.length} active employee(s) without a login · ` +
      `${toProvision.length} to provision · ${skipped} skipped (an account already exists on that email)`,
  );
  for (const e of toProvision) console.log(`  + ${e.odooId}  ${e.name}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to provision.");
    return;
  }

  let provisioned = 0;
  for (const e of toProvision) {
    const email = e.email.toLowerCase().trim();
    // One transaction per employee, not one for the whole batch: a single bad row should
    // cost one employee, not the run. There is no cross-row invariant to protect here —
    // unlike the import, where §3.5's all-or-nothing is the whole promise.
    await withAuditContext({}, () =>
      auditedTransaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, name: e.name, role: "VIEWER" },
          select: { id: true },
        });
        await tx.employee.update({ where: { id: e.id }, data: { userId: user.id } });
      }),
    );
    provisioned++;
  }
  console.log(`\nProvisioned ${provisioned} passwordless VIEWER login(s).`);
  console.log(
    "None of them can be signed into yet. Configure AUTH_ENTRA_ID / AUTH_ENTRA_SECRET / " +
      "AUTH_ENTRA_TENANT_ID, or set a password for a named person at /admin/access.",
  );
}

/**
 * Give the five demo-cast accounts a password so they can be signed into before an IdP
 * exists. Deliberately narrow: it refuses to touch anybody who is not on the list, and it
 * refuses to run at all unless every password is supplied, so a partial cast is never the
 * thing discovered on stage.
 */
async function demoCast() {
  const ids = Object.keys(DEMO_CAST_ODOO_IDS);
  const employees = await prisma.employee.findMany({
    where: { odooId: { in: ids } },
    select: { id: true, odooId: true, name: true, email: true, userId: true },
  });

  const missing = ids.filter((id) => !employees.some((e) => e.odooId === id));
  if (missing.length) {
    console.error(
      `These cast members are not in this database: ${missing.join(", ")}. ` +
        `Is this the right deployment, and has the fixture been seeded?`,
    );
    process.exitCode = 1;
    return;
  }

  const noPassword = ids.filter((id) => !process.env[`DEMO_PASSWORD_${id}`]);
  if (noPassword.length) {
    console.error("Set one password per person, in the environment, before running this:\n");
    for (const id of ids) {
      console.error(`  DEMO_PASSWORD_${id}=…   # ${DEMO_CAST_ODOO_IDS[id]}`);
    }
    console.error(
      `\nMissing: ${noPassword.map((id) => `DEMO_PASSWORD_${id}`).join(", ")}.\n` +
        `One password EACH — a single value shared across the five is the thing ` +
        `ADR-069's passwordless provisioning exists to avoid.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Demo cast — ${employees.length} people:\n`);
  for (const e of employees) {
    console.log(`  ${e.odooId}  ${e.name}  ${e.userId ? "(has a login)" : "(no login yet)"}`);
    console.log(`      ${DEMO_CAST_ODOO_IDS[e.odooId]}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no password was set. Re-run with --apply.");
    return;
  }

  for (const e of employees) {
    const email = e.email.toLowerCase().trim();
    // Hashed with the app's own function, so these accounts are indistinguishable from
    // one made at /admin/access/new — no second password format to support later.
    const passwordHash = await hashPassword(process.env[`DEMO_PASSWORD_${e.odooId}`]);
    await withAuditContext({}, () =>
      auditedTransaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
        const userId = existing
          ? (
              await tx.user.update({
                where: { id: existing.id },
                // `passwordChangedAt` stamps the epoch lib/auth.ts's jwt callback compares
                // against, so any session issued before this is torn down on its next
                // request — the same mechanism a real password reset uses.
                data: { passwordHash, passwordChangedAt: new Date() },
                select: { id: true },
              })
            ).id
          : (
              await tx.user.create({
                // No `passwordChangedAt` on a fresh account, deliberately and to match
                // `POST /api/users`: the column records that a password was CHANGED, and
                // an account with no prior sessions has nothing to invalidate. Null reads
                // as epoch 0 in the jwt comparison, which is the right answer.
                data: { email, name: e.name, role: "VIEWER", passwordHash },
                select: { id: true },
              })
            ).id;
        if (e.userId !== userId) {
          await tx.employee.update({ where: { id: e.id }, data: { userId } });
        }
      }),
    );
    console.log(`  set: ${e.odooId} ${e.name}`);
  }
  console.log(
    `\nDone. These are a DEMO SCAFFOLD, not the plan — change or delete them afterwards. ` +
      `The real path is the corporate IdP, where no password exists anywhere.`,
  );
}

(DEMO_CAST ? demoCast() : main())
  .catch((e) => {
    console.error("provision-logins failed:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
