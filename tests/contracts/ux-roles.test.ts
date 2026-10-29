import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { newPermissions, permissionDiff } from "../../lib/rbac/diff";
import { assignmentFilterSchema, effectiveAccessQuerySchema } from "../../lib/validations/rbac";

/**
 * UX P1 phase 4 (docs/blueprints/ux-p1-roles.md): the role builder's gain/lose
 * preview, "view access as…", holders, and the end of runtime pmsRoles reads.
 */

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};

let findArgs: { where?: Record<string, unknown>; take?: number } | null = null;
const assignmentRows = [
  {
    id: "a1",
    scopeType: "GROUP",
    scopeId: null,
    validUntil: null,
    role: { id: "r1", name: "HR Manager", permissions: ["people.view", "jml.view"] },
  },
  {
    id: "a2",
    scopeType: "COMPANY",
    scopeId: "c1",
    validUntil: null,
    role: { id: "r2", name: "Hiring Admin", permissions: ["people.view", "hiring.view"] },
  },
];

let service: typeof import("../../lib/rbac/service");

before(async () => {
  const empty = { findMany: async () => [] };
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        roleAssignment: {
          findMany: async (args: typeof findArgs) => {
            findArgs = args;
            return assignmentRows;
          },
        },
        orgEntity: { findMany: async () => [{ id: "c1", name: "Rihal" }] },
        directorate: empty,
        department: empty,
        hrTagPair: empty,
      },
    },
  });
  service = await import("../../lib/rbac/service");
});

test("permissionDiff: what a role edit grants and revokes", () => {
  assert.deepEqual(permissionDiff(["a", "b"], ["b", "c"]), { gained: ["c"], lost: ["a"] });
  assert.deepEqual(permissionDiff(["a"], ["a"]), { gained: [], lost: [] });
  assert.deepEqual(newPermissions(["a", "b"], ["b", "c", "d"]), ["c", "d"]);
});

test("effective access: active window only, each permission with its labelled scopes", async () => {
  const out = await service.effectiveAccess("u1");
  assert.equal(findArgs?.where?.userId, "u1");
  assert.ok(JSON.stringify(findArgs?.where).includes("validUntil"), "expired grants excluded");
  assert.ok(JSON.stringify(findArgs?.where).includes("validFrom"), "future grants excluded");
  assert.equal(findArgs?.take, 200);
  const view = out.permissions.find((p) => p.code === "people.view");
  assert.deepEqual(view?.scopes, [
    { type: "GROUP", label: null },
    { type: "COMPANY", label: "Rihal" },
  ]);
  assert.deepEqual(
    out.assignments.map((a) => [a.role.name, a.scope.label]),
    [
      ["HR Manager", null],
      ["Hiring Admin", "Rihal"],
    ],
  );
});

test("the preview and the holder list are platform-admin only and validated", () => {
  const effective = readFileSync("app/api/rbac/effective/route.ts", "utf8");
  assert.match(effective, /withRateLimit\(\s*withAdminAuth\(/);
  assert.match(effective, /effectiveAccessQuerySchema\.safeParse/);
  const list = readFileSync("app/api/rbac/assignments/route.ts", "utf8");
  assert.match(list, /assignmentFilterSchema\.safeParse/);
  assert.ok(!effectiveAccessQuerySchema.safeParse({}).success);
  assert.ok(!assignmentFilterSchema.safeParse({ roleId: "x".repeat(65) }).success);
});

test("a role still held cannot be deleted from the screen (the server refuses too)", () => {
  const ui = readFileSync("components/rbac/RolesSection.tsx", "utf8");
  assert.match(ui, /role\._count\.assignments > 0 \? \(\s*<Button[^>]*disabled/);
  assert.match(readFileSync("lib/rbac/service.ts", "utf8"), /Remove those assignments first/);
});

/** Every .ts/.tsx under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test("R13: no runtime code reads Employee.pmsRoles from the database any more", () => {
  const offenders = ["lib", "app", "components"]
    .flatMap(sources)
    .filter((f) => !f.startsWith(join("lib", "validations")))
    .filter((f) => /pmsRoles:\s*(true|\{)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "authority comes from role assignments (lib/rbac)");
});

test("R13: the Employee.pmsRoles column and its enum are gone, and no seed writes them", () => {
  const schema = readFileSync(join("prisma", "schema.prisma"), "utf8");
  assert.doesNotMatch(schema, /^\s+pmsRoles\s/m, "no pmsRoles field on any model");
  assert.doesNotMatch(schema, /^enum PmsRole\b/m, "no PmsRole enum");
  for (const seed of ["seed.ts", "seed-pms.ts", "seed-demo-cycle.ts"]) {
    const text = readFileSync(join("prisma", seed), "utf8");
    assert.doesNotMatch(text, /pmsRoles/, `${seed} must not use the dropped column`);
  }
});
