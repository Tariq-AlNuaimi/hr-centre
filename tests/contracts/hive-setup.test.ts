import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  coverageSchema,
  discountSchema,
  isReferenceResource,
  memberSchema,
  orgInfoSchema,
  rotationConfigSchema,
} from "../../lib/validations/hive/reference";
import { firstSheetRows } from "../../lib/hive/provider-import";

/**
 * HR tickets reference data (docs/blueprints/hive.md US-H9): the screens HIVE
 * never had. Pins the boundary rules, the member ↔ login link and the gates.
 */

describe("boundary", () => {
  test("only the seven reference lists are addressable", () => {
    for (const r of [
      "pairs",
      "members",
      "coverage",
      "rotation-groups",
      "rotation-coverage",
      "discounts",
      "providers",
    ]) {
      assert.ok(isReferenceResource(r), r);
    }
    for (const r of ["users", "constructor", "escalations", "__proto__"]) {
      assert.equal(isReferenceResource(r), false, r);
    }
  });

  test("a company-wide coverage row must name its company", () => {
    const base = { pairId: "p", label: "TP (all)", aliases: ["TP"] };
    assert.ok(!coverageSchema.safeParse({ ...base, companyWide: true }).success);
    assert.ok(coverageSchema.safeParse({ ...base, companyWide: true, entityId: "c-tp" }).success);
  });

  test("aliases are trimmed, de-duplicated and blank-free", () => {
    const parsed = coverageSchema.parse({
      pairId: "p",
      label: "Tech",
      aliases: [" DevOps ", "DevOps", "", "QA"],
    });
    assert.deepEqual(parsed.aliases, ["DevOps", "QA"]);
  });

  test("member email is lower-cased; an empty phone becomes null", () => {
    const m = memberSchema.parse({
      pairId: "p",
      name: "A",
      email: "Rahma.Adam@Rihal.om",
      phone: "",
    });
    assert.equal(m.email, "rahma.adam@rihal.om");
    assert.equal(m.phone, null);
  });

  test("a discount with no end date is 'not specified' (null), never expired", () => {
    const d = discountSchema.parse({ name: "Alhut", offerSummary: "Wash", validUntil: "" });
    assert.equal(d.validUntil, null);
    const e = discountSchema.parse({
      name: "Silaf",
      offerSummary: "10%",
      validUntil: "2027-06-27",
    });
    assert.equal((e.validUntil as Date).toISOString().slice(0, 10), "2027-06-27");
    assert.ok(
      !discountSchema.safeParse({ name: "X", offerSummary: "Y", validUntil: "2026-02-30" }).success,
    );
    assert.ok(
      !discountSchema.safeParse({ name: "X", offerSummary: "Y", url: "javascript:x" }).success,
    );
  });

  test("the rotation anchor must be a Sunday; weekend days are ISO 1–7", () => {
    const ok = {
      anchorDate: "2026-03-29",
      anchorType: "A",
      timezone: "Asia/Muscat",
      weekendDays: [6, 5, 5],
    };
    assert.deepEqual(rotationConfigSchema.parse(ok).weekendDays, [5, 6]);
    assert.ok(
      !rotationConfigSchema.safeParse({ ...ok, anchorDate: "2026-03-30" }).success,
      "a Monday",
    );
    assert.ok(!rotationConfigSchema.safeParse({ ...ok, timezone: "Mars/Olympus" }).success);
    assert.ok(!rotationConfigSchema.safeParse({ ...ok, weekendDays: [0] }).success);
  });

  test("org details describe a known unit kind only", () => {
    assert.ok(orgInfoSchema.safeParse({ kind: "DIRECTORATE", unitId: "d1" }).success);
    assert.ok(!orgInfoSchema.safeParse({ kind: "EMPLOYEE", unitId: "e1" }).success);
  });
});

describe("provider spreadsheet", () => {
  test("read-excel-file v9 returns the workbook; the first sheet is the list", () => {
    const rows = [
      ["Name", "Location"],
      ["Badr", "Muscat"],
    ];
    assert.deepEqual(firstSheetRows([{ sheet: "Providers", data: rows }]), rows);
    assert.deepEqual(firstSheetRows(rows), rows, "plain rows still work");
    assert.deepEqual(firstSheetRows([]), []);
  });
});

// --- the member ↔ login link (OWN_HR_PAIR) ---------------------------------

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Ref = typeof import("../../lib/hive/services/reference");
let ref: Ref;
let users: Array<{ id: string; email: string; hiveTagMember: { id: string } | null }> = [];
let members: Array<{ id: string; email: string }> = [];
const created: Record<string, unknown>[] = [];

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        hrTagPair: { findFirst: async () => ({ id: "p1" }) },
        hrTagMember: {
          findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
            members.find((m) => m.email === where.email.equals.toLowerCase()) ?? null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: "m-new" };
          },
        },
        user: {
          findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
            users.find((u) => u.email === where.email.equals.toLowerCase()) ?? null,
        },
      },
    },
  });
  ref = (await import(import.meta.resolve("../../lib/hive/services/reference.ts"))) as Ref;
});

describe("member ↔ login link", { skip: !canMock }, () => {
  test("a member is linked to the login with the same email", async () => {
    users = [{ id: "u-rahma", email: "rahma.adam@rihal.om", hiveTagMember: null }];
    members = [];
    created.length = 0;
    await ref.createReference("members", {
      pairId: "p1",
      name: "Rahma Adam",
      email: "rahma.adam@rihal.om",
      phone: null,
      order: 1,
    });
    assert.equal(created[0].userId, "u-rahma");
  });

  test("no login with that email → unlinked; a login already linked elsewhere is not taken", async () => {
    users = [{ id: "u-x", email: "x@rihal.om", hiveTagMember: { id: "m-other" } }];
    members = [];
    created.length = 0;
    await ref.createReference("members", {
      pairId: "p1",
      name: "N",
      email: "n@rihal.om",
      phone: null,
      order: 0,
    });
    await ref.createReference("members", {
      pairId: "p1",
      name: "X",
      email: "x@rihal.om",
      phone: null,
      order: 0,
    });
    assert.equal(created[0].userId, null);
    assert.equal(created[1].userId, null, "one member per login (member_taken)");
  });

  test("the same person cannot be a member twice", async () => {
    members = [{ id: "m1", email: "rahma.adam@rihal.om" }];
    await assert.rejects(
      ref.createReference("members", {
        pairId: "p1",
        name: "R",
        email: "rahma.adam@rihal.om",
        phone: null,
        order: 0,
      }),
      /already a member/,
    );
  });
});

// --- gates --------------------------------------------------------------------

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? routeFiles(`${dir}/${e.name}`)
      : e.name === "route.ts"
        ? [`${dir}/${e.name}`]
        : [],
  );
}

test("every reference-data route is session-wrapped and needs tickets.configure", () => {
  const files = [
    ...routeFiles("app/api/hive/admin/ref"),
    "app/api/hive/admin/rotation-config/route.ts",
    "app/api/hive/admin/org-info/route.ts",
    "app/api/hive/admin/providers/import/route.ts",
  ];
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const handlers = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) =/g)].length;
    assert.ok(handlers > 0, f);
    assert.equal(
      [...src.matchAll(/requireHivePermission\("configure"/g)].length,
      handlers,
      `${f}: every handler gated on configure`,
    );
    assert.equal([...src.matchAll(/withAuth\(/g)].length, handlers, `${f}: every handler withAuth`);
  }
});

test("the setup screens are server-gated on tickets.configure", () => {
  const layout = readFileSync("app/[locale]/(dashboard)/tickets/setup/(config)/layout.tsx", "utf8");
  assert.match(layout, /permissions\.configure/);
  assert.match(layout, /notFound\(\)/);
});
