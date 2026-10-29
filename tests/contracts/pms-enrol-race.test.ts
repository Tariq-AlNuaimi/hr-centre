// QA2 N-18 — enrolment races a deletion. `enrolParticipants` reads a snapshot of
// active employees, then creates one participant row each; an employee deleted
// in between (an import rollback, a recycling-bin purge, or a test suite's
// teardown running beside another suite) made the create fail on
// `cycle_participants_employee_id_fkey` and aborted the whole enrolment. That
// person simply no longer exists to enrol: skip them, enrol everyone else.
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

const created: string[] = [];
const client = {
  employee: { findMany: async () => [{ id: "e1" }, { id: "gone" }, { id: "e3" }] },
  cycleParticipant: {
    findMany: async () => [],
    create: async ({ data }: { data: { employeeId: string } }) => {
      if (data.employeeId === "gone") {
        throw Object.assign(new Error("Foreign key constraint violated"), { code: "P2003" });
      }
      created.push(data.employeeId);
      return { id: data.employeeId };
    },
  },
};

const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};
let cycle: typeof import("../../lib/pms/cycle");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: { prisma: client, prismaUnfiltered: client },
  });
  cycle = await import("../../lib/pms/cycle");
});

test("N-18 an employee deleted mid-enrolment is skipped; everyone else is still enrolled", async () => {
  const out = await cycle.enrolParticipants("c1");
  assert.deepEqual(created, ["e1", "e3"]);
  assert.equal(out.added, 2);
});
