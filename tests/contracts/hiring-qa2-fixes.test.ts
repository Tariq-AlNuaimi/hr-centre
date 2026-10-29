// QA run 2 (2026-10-29) regressions in Hiring. Each test was written failing first.
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const employees = [{ id: "emp-rashid", userId: "user-rashid", status: "ACTIVE" }];
const sent: Array<{ ids: string[]; key: string }> = [];
const client = {
  approvalDelegation: {
    findMany: async ({ where }: { where: { delegatorId: { in: string[] } } }) =>
      where.delegatorId.in.includes("khalid")
        ? [
            {
              delegateId: "sultan",
              validFrom: new Date(Date.now() - 1000),
              validUntil: new Date(Date.now() + 86_400_000),
              revokedAt: null,
            },
          ]
        : [],
  },
  employee: {
    findFirst: async ({ where }: { where: { userId: string; status: string } }) =>
      employees.find((e) => e.userId === where.userId && e.status === where.status) ?? null,
  },
};
const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};
let prejoiner: typeof import("../../lib/hiring/prejoiner");
let notify: typeof import("../../lib/hiring/notify");

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: client,
      prismaUnfiltered: client,
      auditedTransaction: async (fn: (tx: unknown) => unknown) => fn(client),
    },
  });
  mockApi.module(import.meta.resolve("../../lib/core/notify/user-notify.ts"), {
    namedExports: {
      notifyUsers: async (ids: Iterable<string>, n: { key: string }) => {
        sent.push({ ids: [...ids], key: n.key });
        return 1;
      },
      resolveUserNotices: async () => 0,
      shortPreview: (s: string) => s,
      PREVIEW_CHARS: 80,
    },
  });
  prejoiner = await import("../../lib/hiring/prejoiner");
  notify = await import("../../lib/hiring/notify");
});

test("N-13 the joiner's line manager is prefilled from the requisition's hiring manager", async () => {
  assert.equal(await prejoiner.hiringManagerEmployeeId("user-rashid"), "emp-rashid");
  assert.equal(await prejoiner.hiringManagerEmployeeId("user-nobody"), null);
  assert.equal(await prejoiner.hiringManagerEmployeeId(null), null);
  const src = readFileSync("lib/hiring/prejoiner.ts", "utf8");
  assert.match(src, /\{ userId: null, managerId \}/, "the pre-joiner is created with it");
});

test("N-15 an approval step waiting on someone who delegated also reaches their delegate", async () => {
  await notify.notifyApprovalStep({
    what: "offer",
    id: "o1",
    title: "Delivery Lead",
    round: "r1",
    step: { sequence: 2, role: "OPERATIONS_DIRECTOR", approvers: [{ id: "khalid" }] } as never,
  });
  const last = sent.at(-1)!;
  assert.deepEqual(last.ids.sort(), ["khalid", "sultan"]);
});

test("N-15 / D-14 deciding a ticket answer (approve or return) clears its 'to approve' notices", () => {
  const send = readFileSync("lib/hive/services/escalation-send.ts", "utf8");
  assert.match(send, /resolveUserNotices\(`tickets:submitted:\$\{id\}:`\)/);
  const queue = readFileSync("lib/hive/services/escalation-queue.ts", "utf8");
  assert.match(queue, /resolveUserNotices\(`tickets:submitted:\$\{id\}:`\)/);
  // The key those prefixes resolve.
  const n = readFileSync("lib/hive/services/ticket-notify.ts", "utf8");
  assert.match(n, /key: `tickets:\$\{kind\}:\$\{ticket\.id\}/);
  // And the delegate hears about a new delegation.
  const d = readFileSync("app/api/approvals/delegations/route.ts", "utf8");
  assert.match(d, /notifyUsers\(\[delegation\.delegateId\]/);
});

test("N-16 a job description cannot go for sign-off while its hiring request is still a draft", async () => {
  const { canSubmitJd } = await import("../../lib/hiring/jd-rules");
  const actor = { id: "hr", canManage: true, hrEligible: true };
  const base = {
    jdStatus: "DRAFT" as const,
    description: "We build things.",
    jdAuthorId: null,
    hiringManagerId: "hm",
    signatures: [],
  };
  const draft = canSubmitJd(actor, { ...base, requisitionStatus: "DRAFT" });
  assert.equal(draft.ok, false);
  assert.match((draft as { reason: string }).reason, /Submit the hiring request first/);
});
