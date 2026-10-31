// ADR-094 follow-up: Hiring requisition approval and JD sign-off on the core
// approvals engine, through Hiring's own services on a real database. Pins the
// rules and sentences users relied on before the move:
//   requisitions — two steps (HR Manager, then Operations Director), different
//   people, never the submitter, only a routed approver; a send-back or a
//   rejection closes the round as that decision; a withdrawal cancels it; a
//   resubmission opens a fresh round and the status history keeps every move.
//   JD — two named signatures from two different people on the CURRENT version;
//   the drafter never gives the HR one; a signer may still send it back; a
//   send-back bumps the version and the next round starts clean.
//   npm run test:integration
import { test, after, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

// revalidateTag needs a Next request store; the careers cache is not under test.
(
  mock as unknown as {
    module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
  }
).module("next/cache", {
  namedExports: { revalidateTag: () => {}, unstable_cache: (f: unknown) => f },
});

const { prismaUnfiltered } = await import("../../lib/prisma");
const { withAuditContext } = await import("../../lib/audit-context");
const { resolveHiringActor } = await import("../../lib/hiring/actor");
const { HiringRuleError } = await import("../../lib/hiring/http");
const { loadRequisition } = await import("../../lib/hiring/requisitions");
const status = await import("../../lib/hiring/requisition-status");
const jd = await import("../../lib/hiring/jd");
const { pendingSteps } = await import("../../lib/hiring/requisition-pending");
const { latestRound } = await import("../../lib/core/approvals/store");
type HiringActor = Awaited<ReturnType<typeof resolveHiringActor>>;

const RUN = `hae${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let dbReachable = false;
let entityId = "";
let departmentId = "";
try {
  const dept = await prismaUnfiltered.department.findFirst({
    select: { id: true, entityId: true },
  });
  if (dept) {
    dbReachable = true;
    entityId = dept.entityId;
    departmentId = dept.id;
  }
} catch {
  dbReachable = false;
}
const skip = !dbReachable;

const PERMS: Record<string, string[]> = {
  submitter: ["hiring.view", "hiring.manage"],
  both: ["hiring.view", "hiring.hrManager", "hiring.operationsDirector"],
  director: ["hiring.view", "hiring.operationsDirector"],
  specialist: ["hiring.view", "hiring.hrSpecialist"],
  hm: ["hiring.view"],
  viewer: ["hiring.view"],
};
const actors: Record<string, HiringActor> = {};
const roleIds: string[] = [];
const reqIds: string[] = [];

before(async () => {
  if (skip) return;
  for (const [label, permissions] of Object.entries(PERMS)) {
    const user = await prismaUnfiltered.user.create({
      data: { email: `${RUN}.${label}@example.test`, name: `HAE ${label}`, role: "VIEWER" },
      select: { id: true, email: true },
    });
    const role = await prismaUnfiltered.accessRole.create({
      data: { name: `${RUN} ${label}`, permissions },
      select: { id: true },
    });
    roleIds.push(role.id);
    await prismaUnfiltered.roleAssignment.create({
      data: { userId: user.id, roleId: role.id, scopeType: "GROUP", note: RUN },
      select: { id: true },
    });
    actors[label] = await resolveHiringActor({
      user: { id: user.id, email: user.email, role: "VIEWER" },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    } as Session);
  }
});

after(async () => {
  if (skip) return;
  await prismaUnfiltered.approvalRequest.deleteMany({ where: { subjectId: { in: reqIds } } });
  await prismaUnfiltered.hiringRequisition.deleteMany({ where: { id: { in: reqIds } } });
  const ids = Object.values(actors).map((a) => a.userId);
  await prismaUnfiltered.roleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prismaUnfiltered.accessRole.deleteMany({ where: { id: { in: roleIds } } });
  await prismaUnfiltered.user.deleteMany({ where: { id: { in: ids } } });
});

async function newRequisition(title: string) {
  const r = await prismaUnfiltered.hiringRequisition.create({
    data: {
      title: `${RUN} ${title}`,
      entityId,
      departmentId,
      hiringManagerId: actors.hm.userId,
      openings: 1,
      targetCloseDate: new Date(Date.now() + 30 * 86_400_000),
      salaryBandMin: 800,
      salaryBandMax: 1200,
      businessNeed: "Growth",
      alternativesConsidered: "None",
      description: "Build things.",
    },
    select: { id: true },
  });
  reqIds.push(r.id);
  return r.id;
}

const load = async (actor: HiringActor, id: string) => (await loadRequisition(actor, id))!;

/** Run a service call; resolve to its result, or reject with the HiringRuleError. */
const as = <T>(fn: () => Promise<T>) => withAuditContext({}, fn);

async function move(actor: HiringActor, id: string, to: string, reason: string) {
  const l = await load(actor, id);
  return as(() =>
    status.changeRequisitionStatus(
      actor,
      l.req,
      l.subject,
      to as Parameters<typeof status.changeRequisitionStatus>[3],
      reason,
    ),
  );
}

const refused =
  (pattern: RegExp, code = 403) =>
  (e: unknown) =>
    e instanceof HiringRuleError && e.status === code && pattern.test(e.message);

test("requisition: two different approvers in order; the submitter never", { skip }, async () => {
  const id = await newRequisition("two-step");
  assert.deepEqual(await move(actors.submitter, id, "PENDING_APPROVAL", "Please approve"), {
    status: "PENDING_APPROVAL",
  });
  let round = await latestRound("hiring.requisition", id);
  assert.deepEqual(
    round!.steps.map((s) => `${s.roleKey}:${s.status}`),
    ["HR_MANAGER:CURRENT", "OPERATIONS_DIRECTOR:WAITING"],
  );
  assert.equal(round!.submittedById, actors.submitter.userId);

  await assert.rejects(move(actors.submitter, id, "OPEN", "Mine"), refused(/you submitted/));
  await assert.rejects(move(actors.viewer, id, "OPEN", "Me"), refused(/routed to this step/));
  assert.deepEqual(await move(actors.both, id, "OPEN", "HR ok"), {
    status: "PENDING_APPROVAL",
    approvalStep: { signed: "HR_MANAGER", next: "OPERATIONS_DIRECTOR" },
  });
  // One person, one step: B holds the Operations Director role too.
  await assert.rejects(move(actors.both, id, "OPEN", "Again"), refused(/earlier step/));
  assert.equal(
    (await pendingSteps([{ id, status: "PENDING_APPROVAL" }])).get(id)?.role,
    "Operations director",
  );
  assert.deepEqual(await move(actors.director, id, "OPEN", "Budget ok"), { status: "OPEN" });

  const req = await prismaUnfiltered.hiringRequisition.findUniqueOrThrow({
    where: { id },
    select: { status: true },
  });
  assert.equal(req.status, "OPEN");
  round = await latestRound("hiring.requisition", id);
  assert.equal(round!.status, "APPROVED");
  assert.deepEqual(
    round!.decisions.map((d) => [d.deciderId, d.comment]),
    [
      [actors.both.userId, "HR ok"],
      [actors.director.userId, "Budget ok"],
    ],
  );
  const history = await prismaUnfiltered.hiringRequisitionStatusHistory.findMany({
    where: { requisitionId: id },
    orderBy: { changedAt: "asc" },
    select: { fromStatus: true, toStatus: true, reason: true },
  });
  assert.deepEqual(
    history.map((h) => `${h.fromStatus}>${h.toStatus}:${h.reason}`),
    ["DRAFT>PENDING_APPROVAL:Please approve", "PENDING_APPROVAL>OPEN:Budget ok"],
  );
  // The approval screen reads the same round.
  const view = await status.currentRound(id);
  assert.deepEqual(
    view.signed.map((s) => s.requiredRole),
    ["HR_MANAGER", "OPERATIONS_DIRECTOR"],
  );
});

test(
  "requisition: a send-back is the approver's decision; resubmitting starts clean",
  { skip },
  async () => {
    const id = await newRequisition("send-back");
    await move(actors.submitter, id, "PENDING_APPROVAL", "First");
    const l = await load(actors.both, id);
    await as(() => status.assertRoutedToActor(actors.both, l.req, l.subject));
    await assert.rejects(
      as(() => status.assertRoutedToActor(actors.director, l.req, l.subject)),
      refused(/Only the approver routed/),
    );
    assert.deepEqual(await move(actors.both, id, "DRAFT", "Sent back — fix the band"), {
      status: "DRAFT",
    });
    const first = await latestRound("hiring.requisition", id);
    assert.equal(first!.status, "SENT_BACK");
    assert.deepEqual(
      first!.steps.map((s) => s.status),
      ["SENT_BACK", "CANCELLED"],
    );
    assert.equal(first!.decisions[0].action, "SENT_BACK");

    await move(actors.submitter, id, "PENDING_APPROVAL", "Second");
    const second = await latestRound("hiring.requisition", id);
    assert.notEqual(second!.id, first!.id);
    assert.equal(second!.status, "PENDING");
    assert.equal(second!.decisions.length, 0);
    assert.equal(
      (await pendingSteps([{ id, status: "PENDING_APPROVAL" }])).get(id)?.role,
      "HR manager",
    );
    // The same approver may sign the new round's first step.
    assert.equal((await move(actors.both, id, "OPEN", "Fixed")).status, "PENDING_APPROVAL");

    // A manager withdrawing a pending request cancels the round.
    assert.deepEqual(await move(actors.submitter, id, "DRAFT", "Withdrawn for now"), {
      status: "DRAFT",
    });
    const third = await latestRound("hiring.requisition", id);
    assert.equal(third!.id, second!.id);
    assert.equal(third!.status, "CANCELLED");
  },
);

async function jdAct(actor: HiringActor, id: string, body: Parameters<typeof jd.applyJdAction>[2]) {
  return as(async () => jd.applyJdAction(actor, await load(actor, id), body));
}

test(
  "JD: two named signatures from two people; the drafter never signs for HR",
  { skip },
  async () => {
    const id = await newRequisition("jd");
    await move(actors.submitter, id, "PENDING_APPROVAL", "Approve please");
    await jdAct(actors.specialist, id, { action: "SUBMIT" });
    let round = await latestRound("hiring.jd", id);
    assert.equal(round!.subjectVersion, 1);
    assert.equal(round!.steps[0].requiredApprovals, 2);

    await assert.rejects(
      jdAct(actors.specialist, id, { action: "SIGN", signatory: "HR" }),
      refused(/You drafted this job description/),
    );
    await assert.rejects(
      jdAct(actors.both, id, { action: "SIGN", signatory: "HIRING_MANAGER" }),
      refused(/Only this requisition's hiring manager/),
    );
    await jdAct(actors.hm, id, { action: "SIGN", signatory: "HIRING_MANAGER", comment: "Mine" });
    await assert.rejects(
      jdAct(actors.hm, id, { action: "SIGN", signatory: "HIRING_MANAGER" }),
      refused(/already recorded/),
    );
    // A signer may still send the version back; it bumps the version.
    await jdAct(actors.hm, id, { action: "REQUEST_CHANGES", comment: "Add travel" });
    let req = await prismaUnfiltered.hiringRequisition.findUniqueOrThrow({
      where: { id },
      select: { jdStatus: true, jdVersion: true },
    });
    assert.deepEqual(req, { jdStatus: "CHANGES_REQUESTED", jdVersion: 2 });
    assert.equal((await latestRound("hiring.jd", id))!.status, "SENT_BACK");

    // Version 2 starts clean; HR then the hiring manager, in either order.
    await jdAct(actors.submitter, id, { action: "SUBMIT" });
    const view = await as(async () => jd.jdView(actors.hm, await load(actors.hm, id)));
    assert.deepEqual(
      view.slots.map((s) => s.signed),
      [false, false],
    );
    assert.deepEqual(view.can.sign, ["HIRING_MANAGER"]);
    await jdAct(actors.both, id, { action: "SIGN", signatory: "HR", comment: "HR ok" });
    await jdAct(actors.hm, id, { action: "SIGN", signatory: "HIRING_MANAGER" });
    req = await prismaUnfiltered.hiringRequisition.findUniqueOrThrow({
      where: { id },
      select: { jdStatus: true, jdVersion: true },
    });
    assert.deepEqual(req, { jdStatus: "APPROVED", jdVersion: 2 });
    round = await latestRound("hiring.jd", id);
    assert.equal(round!.status, "APPROVED");
    assert.deepEqual(round!.decisions.map((d) => d.slot).sort(), ["HIRING_MANAGER", "HR"]);

    // The history lists every signature and send-back across versions, newest first.
    const done = await as(async () => jd.jdView(actors.hm, await load(actors.hm, id)));
    assert.deepEqual(
      done.history.map((h) => `${h.version}:${h.action}:${h.signatory ?? "-"}`),
      [
        "2:SIGNED:HIRING_MANAGER",
        "2:SIGNED:HR",
        "1:CHANGES_REQUESTED:-",
        "1:SIGNED:HIRING_MANAGER",
      ],
    );
    assert.deepEqual(
      done.slots.map((s) => s.signed),
      [true, true],
    );
  },
);

test("JD: editing the description under sign-off voids the round", { skip }, async () => {
  const id = await newRequisition("jd-void");
  await move(actors.submitter, id, "PENDING_APPROVAL", "Approve please");
  await jdAct(actors.submitter, id, { action: "SUBMIT" });
  await jdAct(actors.hm, id, { action: "SIGN", signatory: "HIRING_MANAGER" });
  const { updateRequisition } = await import("../../lib/hiring/requisition-write");
  const l = await load(actors.submitter, id);
  await as(() =>
    updateRequisition(actors.submitter, l.req, { description: "Build other things." } as never),
  );
  const round = await latestRound("hiring.jd", id);
  assert.equal(round!.status, "CANCELLED");
  const view = await as(async () => jd.jdView(actors.hm, await load(actors.hm, id)));
  assert.equal(view.jdVersion, 2);
  assert.deepEqual(
    view.slots.map((s) => s.signed),
    [false, false],
  );
});
