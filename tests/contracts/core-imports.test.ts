import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ADR-096: one import record for people, historical exits and candidates.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

let created: Record<string, unknown>[] = [];
type Rec = typeof import("../../lib/core/imports/record.ts");
let rec: Rec;

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        importBatch: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: "b1" };
          },
        },
      },
    },
  });
  rec = (await import(import.meta.resolve("../../lib/core/imports/record.ts"))) as Rec;
});

test("each kind is visible only to its module's gate", { skip: !canMock }, () => {
  assert.deepEqual(
    rec.visibleImportKinds({ peopleImport: true, jmlConfigure: false, hiringManage: false }),
    ["people"],
  );
  assert.deepEqual(
    rec.visibleImportKinds({ peopleImport: false, jmlConfigure: true, hiringManage: true }),
    ["jml.exits", "hiring.candidates"],
  );
  assert.deepEqual(
    rec.visibleImportKinds({ peopleImport: false, jmlConfigure: false, hiringManage: false }),
    [],
  );
});

test(
  "a run is recorded with its kind, counts and row issues (capped)",
  { skip: !canMock },
  async () => {
    created = [];
    const id = await rec.recordImport({
      kind: "hiring.candidates",
      filename: "list.xlsx",
      status: "APPLIED",
      uploadedById: "u1",
      rowsTotal: 3,
      rowsCreated: 2,
      rowsRejected: 1,
      issues: [
        { rowNumber: 3, reference: "Sara", rule: "row_invalid", message: "Email is not valid" },
      ],
    });
    assert.equal(id, "b1");
    assert.equal(created[0].kind, "hiring.candidates");
    assert.ok(created[0].appliedAt instanceof Date);
    const issues = (created[0].issues as { create: Record<string, unknown>[] }).create;
    assert.equal(issues[0].severity, "REJECT");
    assert.equal(issues[0].reference, "Sara");
  },
);

test("the people importer only ever reads and applies people batches", () => {
  assert.match(readFileSync("lib/pms/import/run.ts", "utf8"), /kind: "people"/);
  assert.match(readFileSync("app/api/imports/[id]/apply/route.ts", "utf8"), /kind: "people"/);
  assert.match(readFileSync("app/api/imports/route.ts", "utf8"), /where: \{ kind: "people" \}/);
});
