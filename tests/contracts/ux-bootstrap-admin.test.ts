import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * UX review P0 (docs/blueprints/ux-p0.md, AC-5.2): the bootstrap administrator
 * holds every module's admin role at Whole group, granted ONCE — by migration on
 * an existing database, by the first-run seed on a fresh one — and the two
 * grant the same set.
 */

const migration = readFileSync(
  "prisma/migrations/20261027180000_ux_p0_bootstrap_admin_roles/migration.sql",
  "utf8",
);
const seed = readFileSync("prisma/seed-foundation.ts", "utf8");
const KEYS = ["HR_SUPER_ADMIN", "JML_HR_MANAGER", "HIRING_ADMIN", "TICKETS_ADMIN"];

test("the migration and the first-run seed grant the same admin roles", () => {
  const sqlKeys = /IN \(([^)]*)\)/.exec(migration)?.[1].match(/'([A-Z_]+)'/g) ?? [];
  assert.deepEqual(sqlKeys.map((k) => k.replace(/'/g, "")).sort(), [...KEYS].sort());
  const seedBlock = /MODULE_ADMIN_STARTER_KEYS = \[([\s\S]*?)\]/.exec(seed)?.[1] ?? "";
  assert.deepEqual(
    (seedBlock.match(/"([A-Z_]+)"/g) ?? []).map((k) => k.replace(/"/g, "")).sort(),
    [...KEYS].sort(),
  );
});

test("the migration targets only the bootstrap record, at Group scope, and never duplicates", () => {
  assert.match(migration, /WHERE e\."odoo_id" = 'BOOTSTRAP-ADMIN'/);
  assert.match(migration, /'GROUP',\s*NULL/);
  assert.match(migration, /NOT EXISTS/);
});

test("the seed grants only on the run that created the bootstrap record", () => {
  // bootstrapAdminEmployee returns a user id only when it created the record,
  // which it does once (no employees yet) — so a deliberate removal sticks.
  assert.match(seed, /if \(existing\) return null;/);
  assert.match(seed, /if \(headcount !== 0\) \{[\s\S]*?return null;/);
  assert.match(
    readFileSync("prisma/seed.ts", "utf8"),
    /grantBootstrapModuleAdmins\(prisma, bootstrappedUserId\)/,
  );
});
