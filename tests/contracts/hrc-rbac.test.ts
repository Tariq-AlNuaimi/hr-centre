import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOUNDATION_STARTER_KEYS, PERMISSION_CODES, STARTER_ROLES } from "../../lib/rbac/catalogue";
import {
  canInScope,
  expandGrants,
  hasGroup,
  isAssignmentActive,
  registerScopeResolver,
  scopeCovers,
  starterGrants,
  validityProblem,
} from "../../lib/rbac/grants";
import { actorCan, capabilitiesFor, type PmsActor } from "../../lib/pms/permissions";
import { assignmentBodySchema, roleBodySchema } from "../../lib/validations/rbac";

/**
 * HR Centre foundation F-c — RBAC (blueprint §3, AC-F3.1–AC-F3.4).
 * AC-F3.4 itself is the untouched Performance suite (tests/contracts/pms-*),
 * which now answers through the starter roles; these pin the rest.
 */

const GROUP = { type: "GROUP", id: null };
const base = { userId: "u1", employeeId: "e1", pmsRoles: [], isLineManager: false } as PmsActor;
const withAssignments = (
  assignments: Array<{
    permissions: readonly string[];
    scope: { type: string; id: string | null };
  }>,
): PmsActor => ({ ...base, grants: expandGrants(assignments) });

test("the migration's starter roles are exactly the catalogue's (lockstep)", () => {
  const sql = readFileSync("prisma/migrations/20261026180000_hrc_rbac/migration.sql", "utf8");
  // Module starter roles (e.g. JML) are created by the seed, not this migration.
  for (const role of STARTER_ROLES.filter((r) => FOUNDATION_STARTER_KEYS.includes(r.key))) {
    const line = sql.split("\n").find((l) => l.includes(`'${role.key}'`) && l.includes("ARRAY["));
    assert.ok(line, `${role.key} is created by the migration`);
    const perms = [...line!.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(perms, [...role.permissions].sort(), role.key);
  }
});

test("AC-F3.4: an assignment-backed actor answers exactly like the legacy pmsRoles one", () => {
  const combos: string[][] = [
    [],
    ["HR_SUPER_ADMIN"],
    ["HRBP"],
    ["EXECUTIVE_VIEWER"],
    ["HRBP", "EXECUTIVE_VIEWER"],
  ];
  for (const roles of combos) {
    for (const isLineManager of [false, true]) {
      const legacy = { ...base, pmsRoles: roles, isLineManager } as PmsActor;
      const modern: PmsActor = {
        ...base,
        isLineManager,
        grants: expandGrants(
          STARTER_ROLES.filter((r) => roles.includes(r.key)).map((r) => ({
            permissions: r.permissions,
            scope: GROUP,
          })),
        ),
      };
      assert.deepEqual(capabilitiesFor(modern), capabilitiesFor(legacy), roles.join("+") || "none");
    }
  }
});

test("AC-F3.2: a company-scoped HRBP sees and edits people in that company only", () => {
  const actor = withAssignments([
    {
      permissions: ["people.view", "people.edit", "perf.runCycle"],
      scope: { type: "COMPANY", id: "cl" },
    },
  ]);
  const caps = capabilitiesFor(actor);
  assert.equal(caps.orgWide, false, "a scoped viewer is not org-wide");
  assert.equal(caps.peopleEdit, true);
  assert.equal(actorCan(actor, "people.edit", { entityId: "cl" }), true);
  assert.equal(actorCan(actor, "people.edit", { entityId: "rihal" }), false);
  // Performance acts org-wide, so a scoped grant of it must not act at all.
  assert.equal(caps.hr, false, "scoped perf.runCycle fails closed");
});

test("directorate and department scopes cover their own people", () => {
  const g = expandGrants([
    { permissions: ["people.view"], scope: { type: "DIRECTORATE", id: "tech" } },
    { permissions: ["people.viewPersonal"], scope: { type: "DEPARTMENT", id: "data" } },
  ]);
  assert.equal(canInScope(g, "people.view", { directorateId: "tech" }), true);
  assert.equal(canInScope(g, "people.view", { directorateId: "ops" }), false);
  assert.equal(canInScope(g, "people.viewPersonal", { departmentId: "data" }), true);
  assert.equal(hasGroup(g, "people.view"), false);
});

test("scope kinds are extensible, and an unknown kind covers nothing", () => {
  assert.equal(scopeCovers({ type: "HR_PAIR", id: "p1" }, { pairId: "p1" }), false);
  registerScopeResolver("TEST_PAIR", (id, s) => s.pairId === id);
  assert.equal(scopeCovers({ type: "TEST_PAIR", id: "p1" }, { pairId: "p1" }), true);
  assert.throws(() => registerScopeResolver("GROUP", () => false), /built in/);
});

test("time-boxed cover: active only inside its window, at most 180 days", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const day = 86_400_000;
  assert.equal(isAssignmentActive({ validFrom: null, validUntil: null }, now), true);
  assert.equal(
    isAssignmentActive({ validFrom: null, validUntil: new Date(now.getTime() - 1) }, now),
    false,
  );
  assert.equal(
    isAssignmentActive({ validFrom: new Date(now.getTime() + day), validUntil: null }, now),
    false,
  );
  assert.equal(validityProblem(null, new Date(now.getTime() + 30 * day), now), null);
  assert.match(validityProblem(null, new Date(now.getTime() + 181 * day), now) ?? "", /180 days/);
  assert.match(validityProblem(now, now, now) ?? "", /after the start/);
});

test("legacy starter grants are Group-scoped", () => {
  const g = starterGrants(["EXECUTIVE_VIEWER"]);
  assert.equal(hasGroup(g, "people.viewSalary"), true);
  assert.equal(hasGroup(g, "perf.runCycle"), false);
});

test("role and assignment bodies are validated against the catalogue", () => {
  assert.equal(roleBodySchema.safeParse({ name: "X", permissions: ["people.fly"] }).success, false);
  assert.equal(roleBodySchema.safeParse({ name: "X", permissions: [] }).success, false);
  const ok = roleBodySchema.parse({
    name: " Payroll ",
    permissions: ["people.view", "people.view"],
  });
  assert.deepEqual(ok.permissions, ["people.view"]);
  assert.ok(PERMISSION_CODES.length >= 14);
  const bad = assignmentBodySchema.safeParse({
    userId: "u",
    roleId: "r",
    scopeType: "GROUP",
    scopeId: "x",
  });
  assert.equal(bad.success, false, "GROUP takes no unit");
  const missing = assignmentBodySchema.safeParse({
    userId: "u",
    roleId: "r",
    scopeType: "COMPANY",
  });
  assert.equal(missing.success, false, "a company scope needs the company");
});

test("AC-F3.3: every RBAC route is platform-admin-only", () => {
  for (const file of [
    "app/api/rbac/roles/route.ts",
    "app/api/rbac/roles/[id]/route.ts",
    "app/api/rbac/assignments/route.ts",
    "app/api/rbac/assignments/[id]/route.ts",
  ]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /withAdminAuth\(/, file);
    assert.doesNotMatch(src, /withAuth\(/, `${file} must not use the any-user wrapper`);
  }
  const page = readFileSync("app/[locale]/(dashboard)/admin/roles/page.tsx", "utf8");
  assert.match(page, /session\.user\.role !== "ADMIN"/);
});
