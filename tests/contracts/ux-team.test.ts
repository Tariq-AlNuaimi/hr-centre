import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * UX P1 phase 5 (docs/blueprints/ux-p1-team.md): the manager's team hub and
 * the hiring manager's "My hiring".
 */

const mockApi = mock as unknown as {
  module: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};

const calls: Record<string, unknown[]> = {};
const record = (name: string, result: unknown) => async (args: unknown) => {
  (calls[name] ??= []).push(args);
  return result;
};

let myHiring: typeof import("../../lib/hiring/my-hiring");
let team: typeof import("../../lib/people/team-overview");

before(async () => {
  const created = new Date("2026-10-01T00:00:00Z");
  const jdRound = (subjectId: string, subjectVersion: number, slot: string) => ({
    subjectId,
    subjectVersion,
    status: "PENDING",
    decisions: [
      {
        action: "APPROVED",
        slot,
        deciderId: "u1",
        decider: { name: "U", email: "u@x" },
        decidedAt: created,
      },
    ],
  });
  mockApi.module(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      auditedTransaction: async () => {
        throw new Error("no writes here");
      },
      prismaUnfiltered: {},
      prisma: {
        hiringRequisition: {
          findMany: record("reqs", [
            {
              id: "r1",
              title: "Data engineer",
              status: "OPEN",
              jdStatus: "AWAITING_SIGNOFF",
              jdVersion: 2,
              createdAt: created,
            },
            {
              id: "r2",
              title: "Designer",
              status: "OPEN",
              jdStatus: "AWAITING_SIGNOFF",
              jdVersion: 1,
              createdAt: created,
            },
          ]),
          count: record("reqCount", 2),
        },
        hiringCandidate: {
          groupBy: record("byStage", [
            { requisitionId: "r1", stage: "SHORTLISTED", _count: { _all: 3 } },
            { requisitionId: "r1", stage: "FIRST_INTERVIEW", _count: { _all: 1 } },
            { requisitionId: "r1", stage: "REJECTED", _count: { _all: 9 } },
          ]),
          findMany: record("awaiting", [
            {
              id: "c1",
              name: "Sara",
              stage: "SHORTLISTED",
              requisitionId: "r1",
              updatedAt: created,
            },
          ]),
        },
        // ADR-094: JD rounds live in the core approvals engine. The HM already
        // signed r2's current version; r1's signature is on an old version.
        approvalRequest: {
          findMany: record("signed", [
            jdRound("r1", 1, "HIRING_MANAGER"),
            jdRound("r2", 1, "HIRING_MANAGER"),
          ]),
        },
        employee: { groupBy: record("reports", [{ status: "ACTIVE", _count: { _all: 4 } }]) },
        jmlCase: {
          findMany: record("cases", [
            {
              id: "k1",
              caseType: "LEAVE",
              employee: { id: "e9", name: "Omar" },
              joinDetail: null,
              moveDetail: null,
              leaveDetail: { lastDayOfService: new Date("2026-11-30") },
            },
          ]),
        },
      },
    },
  });
  myHiring = await import("../../lib/hiring/my-hiring");
  team = await import("../../lib/people/team-overview");
});

test("Advance means the next stage on the linear path", () => {
  assert.equal(myHiring.nextStage("SHORTLISTED"), "ASSESSMENT");
  assert.equal(myHiring.nextStage("DECISION_PENDING"), "OFFER_DRAFTED");
  assert.equal(myHiring.nextStage("HIRED"), null);
});

test("My hiring shows only the viewer's own live requisitions, by phase, bounded", async () => {
  const out = await myHiring.myHiring("u1", new Date("2026-10-11T00:00:00Z"));
  const where = calls.reqs![0] as { where: { hiringManagerId: string }; take: number };
  assert.equal(where.where.hiringManagerId, "u1");
  assert.equal(where.take, 30);
  const r1 = out.requisitions.find((r) => r.id === "r1")!;
  assert.equal(r1.daysOpen, 10);
  // Apply, Screen, Interview, … — rejected candidates are not in any phase.
  assert.deepEqual(r1.perStep, [0, 3, 1, 0, 0, 0, 0]);
  assert.equal(out.awaitingReview[0]!.next, "ASSESSMENT");
  assert.equal(out.awaitingReview[0]!.requisition.title, "Data engineer");
  assert.ok(!("email" in out.awaitingReview[0]!), "no contact details in the review list");
  // r2's current version already carries the HM signature; r1's does not.
  assert.deepEqual(
    out.jdSignoffs.map((j) => j.id),
    ["r1"],
  );
});

test("the team overview is keyed on the viewer's own reporting line", async () => {
  const out = await team.teamOverview({ employeeId: "m1", userId: "u1" });
  const caseArgs = calls.cases!.at(-1) as {
    where: { employee: { managerId: string } };
    take: number;
  };
  assert.equal(caseArgs.where.employee.managerId, "m1");
  assert.equal(caseArgs.take, 20);
  assert.deepEqual(out.reports, { ACTIVE: 4 });
  assert.equal(out.cases[0]!.type, "LEAVE");
  assert.equal(out.cases[0]!.keyDate?.toISOString().slice(0, 10), "2026-11-30");
  assert.equal(out.openRequisitions, 2);
});

test("someone with no employee record gets no team, only their requisitions", async () => {
  const before = calls.cases!.length;
  const out = await team.teamOverview({ employeeId: null, userId: "u1" });
  assert.equal(calls.cases!.length, before, "no case query without a reporting line");
  assert.deepEqual(out.cases, []);
});

test("routes and pages carry their gates", () => {
  const route = readFileSync("app/api/team/overview/route.ts", "utf8");
  assert.match(route, /withRateLimit\(\s*withAuth\(/);
  assert.ok(!/searchParams|params/.test(route), "no id to probe — the viewer's own team only");
  const page = readFileSync("app/[locale]/(dashboard)/team/hiring/page.tsx", "utf8");
  assert.match(page, /if \(!ownsRequisitions\(ctx\)\) notFound\(\)/);
  const review = readFileSync("components/hiring/MyHiringReview.tsx", "utf8");
  assert.match(review, /\/api\/hiring\/candidates\/\$\{candidateId\}\/stage/);
});
