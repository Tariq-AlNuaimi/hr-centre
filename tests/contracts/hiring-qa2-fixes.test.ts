// QA run 2 (2026-10-29) regressions in Hiring. Each test was written failing first.
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const employees = [{ id: "emp-rashid", userId: "user-rashid", status: "ACTIVE" }];
const client = {
  employee: {
    findFirst: async ({ where }: { where: { userId: string; status: string } }) =>
      employees.find((e) => e.userId === where.userId && e.status === where.status) ?? null,
  },
};
const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};
let prejoiner: typeof import("../../lib/hiring/prejoiner");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: client,
      prismaUnfiltered: client,
      auditedTransaction: async (fn: (tx: unknown) => unknown) => fn(client),
    },
  });
  prejoiner = await import("../../lib/hiring/prejoiner");
});

test("N-13 the joiner's line manager is prefilled from the requisition's hiring manager", async () => {
  assert.equal(await prejoiner.hiringManagerEmployeeId("user-rashid"), "emp-rashid");
  assert.equal(await prejoiner.hiringManagerEmployeeId("user-nobody"), null);
  assert.equal(await prejoiner.hiringManagerEmployeeId(null), null);
  const src = readFileSync("lib/hiring/prejoiner.ts", "utf8");
  assert.match(src, /\{ userId: null, managerId \}/, "the pre-joiner is created with it");
});
