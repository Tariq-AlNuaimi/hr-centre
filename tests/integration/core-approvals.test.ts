// ADR-094: the core approvals engine on a real database — a round opens with
// step 1 current, a middle approval moves it on, two-holder steps need two
// people, a send-back closes the round, a resubmission cancels the open round,
// a racing second decision loses, and delegation decides on behalf. Run with
//   npm run test:integration
import { test, after, before } from "node:test";
import assert from "node:assert/strict";

import { auditedTransaction, prismaUnfiltered } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import {
  ApprovalRefusal,
  createDelegation,
  decide,
  delegatorsFor,
  latestRound,
  openRound,
  revokeDelegation,
} from "../../lib/core/approvals/store";

const RUN = `ap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let dbReachable = false;
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  dbReachable = true;
} catch {
  dbReachable = false;
}

const users: Record<string, string> = {};
const SUBJECT = "test.subject";

before(async () => {
  if (!dbReachable) return;
  for (const label of ["submitter", "a", "b", "c", "delegate"]) {
    const u = await prismaUnfiltered.user.create({
      data: { email: `${RUN}.${label}@example.test`, name: `AP ${label}`, role: "VIEWER" },
      select: { id: true },
    });
    users[label] = u.id;
  }
});

after(async () => {
  if (!dbReachable) return;
  await prismaUnfiltered.approvalRequest
    .deleteMany({ where: { subjectType: SUBJECT, subjectId: { startsWith: RUN } } })
    .catch(() => {});
  await prismaUnfiltered.approvalDelegation
    .deleteMany({ where: { delegatorId: { in: Object.values(users) } } })
    .catch(() => {});
  await prismaUnfiltered.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const open = (subjectId: string, steps: { required?: number }[]) =>
  withAuditContext({}, () =>
    auditedTransaction((tx) =>
      openRound(tx, {
        module: "test",
        subjectType: SUBJECT,
        subjectId,
        title: "Test",
        href: "/x",
        submittedById: users.submitter,
        steps: steps.map((s, i) => ({
          roleKey: `R${i + 1}`,
          label: `Role ${i + 1}`,
          requiredApprovals: s.required,
        })),
      }),
    ),
  );

const holder = async () => ({ onBehalfOfId: null, viaProxy: false });
const by = (
  subjectId: string,
  actorId: string,
  action: "APPROVED" | "REJECTED" | "SENT_BACK" = "APPROVED",
) =>
  withAuditContext({}, () =>
    decide({ subjectType: SUBJECT, subjectId, actorId, action, comment: "ok", qualify: holder }),
  );

test(
  "a two-step round: step 1 current, then step 2, then approved",
  { skip: !dbReachable },
  async () => {
    const id = `${RUN}-two`;
    await open(id, [{}, {}]);
    let r = await latestRound(SUBJECT, id);
    assert.deepEqual(
      r!.steps.map((s) => s.status),
      ["CURRENT", "WAITING"],
    );
    assert.equal((await by(id, users.a)).outcome, "STEP_APPROVED");
    r = await latestRound(SUBJECT, id);
    assert.deepEqual(
      r!.steps.map((s) => s.status),
      ["APPROVED", "CURRENT"],
    );
    // One person, one step: A cannot take step 2 as well.
    await assert.rejects(
      by(id, users.a),
      (e: unknown) => (e as ApprovalRefusal).code === "PRIOR_STEP",
    );
    assert.equal((await by(id, users.b)).outcome, "APPROVED");
    r = await latestRound(SUBJECT, id);
    assert.equal(r!.status, "APPROVED");
    assert.ok(r!.closedAt);
  },
);

test("self-approval is refused", { skip: !dbReachable }, async () => {
  const id = `${RUN}-self`;
  await open(id, [{}]);
  await assert.rejects(
    by(id, users.submitter),
    (e: unknown) => (e as ApprovalRefusal).code === "SUBMITTER",
  );
});

test("a two-holder step needs two different people", { skip: !dbReachable }, async () => {
  const id = `${RUN}-pair`;
  await open(id, [{ required: 2 }]);
  assert.equal((await by(id, users.a)).outcome, "STEP_RECORDED");
  await assert.rejects(by(id, users.a), (e: unknown) => (e as ApprovalRefusal).code === "ALREADY");
  assert.equal((await by(id, users.b)).outcome, "APPROVED");
});

test(
  "a send-back closes the round and cancels the waiting steps",
  { skip: !dbReachable },
  async () => {
    const id = `${RUN}-back`;
    await open(id, [{}, {}]);
    assert.equal((await by(id, users.a, "SENT_BACK")).outcome, "SENT_BACK");
    const r = await latestRound(SUBJECT, id);
    assert.equal(r!.status, "SENT_BACK");
    assert.deepEqual(
      r!.steps.map((s) => s.status),
      ["SENT_BACK", "CANCELLED"],
    );
    await assert.rejects(
      by(id, users.b),
      (e: unknown) => (e as ApprovalRefusal).code === "NOT_PENDING",
    );
  },
);

test(
  "resubmitting cancels the open round; earlier decisions stay on record",
  { skip: !dbReachable },
  async () => {
    const id = `${RUN}-resub`;
    await open(id, [{}, {}]);
    await by(id, users.a);
    await open(id, [{}, {}]);
    const rounds = await prismaUnfiltered.approvalRequest.findMany({
      where: { subjectType: SUBJECT, subjectId: id },
      orderBy: { createdAt: "asc" },
      select: { status: true, decisions: { select: { deciderId: true } } },
    });
    assert.deepEqual(
      rounds.map((r) => r.status),
      ["CANCELLED", "PENDING"],
    );
    assert.equal(rounds[0].decisions[0].deciderId, users.a);
    // A starts clean in the new round.
    assert.equal((await by(id, users.a)).outcome, "STEP_APPROVED");
  },
);

test("two people racing the same step: exactly one wins", { skip: !dbReachable }, async () => {
  const id = `${RUN}-race`;
  await open(id, [{}, {}]);
  const results = await Promise.allSettled([by(id, users.a), by(id, users.b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const r = await latestRound(SUBJECT, id);
  assert.equal(r!.decisions.length, 1);
});

test(
  "a delegate decides on behalf of the holder, within the window only",
  { skip: !dbReachable },
  async () => {
    const now = Date.now();
    const d = await withAuditContext({}, () =>
      createDelegation({
        delegatorId: users.c,
        delegateId: users.delegate,
        module: "hiring",
        validFrom: new Date(now - 60_000),
        validUntil: new Date(now + 3_600_000),
      }),
    );
    assert.deepEqual(await delegatorsFor(users.delegate, "hiring"), [users.c]);
    assert.deepEqual(await delegatorsFor(users.delegate, "jml"), []);
    const id = `${RUN}-deleg`;
    await open(id, [{}]);
    const result = await withAuditContext({}, () =>
      decide({
        subjectType: SUBJECT,
        subjectId: id,
        actorId: users.delegate,
        action: "APPROVED",
        qualify: async () => ({ onBehalfOfId: users.c, viaProxy: false }),
      }),
    );
    assert.equal(result.outcome, "APPROVED");
    const r = await latestRound(SUBJECT, id);
    assert.equal(r!.decisions[0].onBehalfOfId, users.c);
    // Only the delegator may end it.
    assert.equal(await withAuditContext({}, () => revokeDelegation(d.id, users.delegate)), false);
    assert.equal(await withAuditContext({}, () => revokeDelegation(d.id, users.c)), true);
    assert.deepEqual(await delegatorsFor(users.delegate, "hiring"), []);
  },
);
