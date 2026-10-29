// Notice recipients filtered by access (docs/blueprints/limits.md slice 2) on a
// real database: a notice about a record reaches only people who can open it —
// bell (the core writer), email (tickets) and My work — for Hiring, JML and
// HR tickets. Two companies, A and B; every "scoped to A" person must hear
// nothing about B's records. Run with `npm run test:integration`.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

import { prismaUnfiltered } from "../../lib/prisma";
import { notifyUsers } from "../../lib/core/notify/user-notify";
import { whoCanOpen } from "../../lib/core/notify/audience";
import { notifyJml } from "../../lib/jml/engine/notify";
import { hiringWorkProvider } from "../../lib/hiring/work-items";
import { jmlWorkProvider } from "../../lib/jml/work-items";
import { DEFAULT_CALENDAR } from "../../lib/working-time/calendar";
import { TEST_EMPLOYEE_PREFIX } from "./fixture";

const RUN = `na-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const email = (l: string) => `${RUN}.${l}@example.test`;

let dbReachable = false;
const A = { entityId: "", departmentId: "" };
const B = { entityId: "", departmentId: "" };
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  const depts = await prismaUnfiltered.department.findMany({
    select: { id: true, entityId: true },
    orderBy: { id: "asc" },
    take: 200,
  });
  const first = depts[0];
  const other = depts.find((d) => d.entityId !== first?.entityId);
  if (first && other) {
    Object.assign(A, { entityId: first.entityId, departmentId: first.id });
    Object.assign(B, { entityId: other.entityId, departmentId: other.id });
    dbReachable = true;
  }
} catch {
  dbReachable = false;
}

const users: string[] = [];
const employees: string[] = [];
const roles: string[] = [];
const u: Record<string, string> = {};
const rec: Record<string, string> = {};

async function person(label: string, place = A) {
  const user = await prismaUnfiltered.user.create({
    data: { email: email(label), name: `NA ${label}`, role: "VIEWER" },
    select: { id: true },
  });
  users.push(user.id);
  const emp = await prismaUnfiltered.employee.create({
    data: {
      odooId: `${TEST_EMPLOYEE_PREFIX}${RUN}-${label}`.slice(0, 60),
      name: `NA ${label}`,
      email: email(label),
      entityId: place.entityId,
      departmentId: place.departmentId,
      roleTrack: "INDIVIDUAL",
      status: "ACTIVE",
      userId: user.id,
      dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
    },
    select: { id: true },
  });
  employees.push(emp.id);
  u[label] = user.id;
  return user.id;
}

/** Give `userId` a role holding `permissions` in one scope. */
async function grant(
  userId: string,
  permissions: string[],
  scopeType: "GROUP" | "COMPANY" | "HR_PAIR",
  scopeId: string | null = null,
) {
  const role = await prismaUnfiltered.accessRole.create({
    data: { name: `${RUN} ${permissions.join("+")} ${roles.length}`, permissions },
    select: { id: true },
  });
  roles.push(role.id);
  await prismaUnfiltered.roleAssignment.create({
    data: { userId, roleId: role.id, scopeType, scopeId },
  });
}

const sessionOf = (label: string): Session => ({
  user: { id: u[label], email: email(label), role: "VIEWER" },
  expires: new Date(Date.now() + 3_600_000).toISOString(),
});

async function bell(label: string, keyPart: string) {
  return prismaUnfiltered.notification.count({
    where: {
      OR: [{ recipientUserId: u[label] }, { recipientEmployee: { userId: u[label] } }],
      dedupeKey: { contains: keyPart },
    },
  });
}

before(async () => {
  if (!dbReachable) return;
  // Hiring: a hiring manager in A, one in B, one org-wide.
  for (const [label, scope] of [
    ["hmA", A],
    ["hmB", B],
  ] as const) {
    await person(label, scope);
    await grant(u[label], ["hiring.view", "hiring.hiringManager"], "COMPANY", scope.entityId);
  }
  await person("hmGroup");
  await grant(u.hmGroup, ["hiring.view"], "GROUP");
  // A role-holder with the approval role org-wide but hiring.view only in A —
  // exactly the case a role-based recipient list gets wrong.
  await person("cooA");
  await grant(u.cooA, ["hiring.coo"], "GROUP");
  await grant(u.cooA, ["hiring.view"], "COMPANY", A.entityId);

  const req = await prismaUnfiltered.hiringRequisition.create({
    data: {
      title: `${RUN} B role`,
      entityId: B.entityId,
      departmentId: B.departmentId,
      hiringManagerId: u.hmB,
    },
    select: { id: true },
  });
  rec.reqB = req.id;
  const cand = await prismaUnfiltered.hiringCandidate.create({
    data: { name: `${RUN} cand`, requisitionId: req.id },
    select: { id: true },
  });
  rec.candB = cand.id;
  const iv = await prismaUnfiltered.hiringInterview.create({
    data: {
      requisitionId: req.id,
      candidateId: cand.id,
      round: "TECHNICAL",
      scheduledDate: new Date(Date.now() - 86_400_000),
    },
    select: { id: true },
  });
  rec.ivB = iv.id;
  for (const p of ["hmA", "hmB"]) {
    await prismaUnfiltered.hiringInterviewPanelist.create({
      data: { interviewId: iv.id, userId: u[p] },
    });
  }

  // JML: HR in A, HR in B; a case for an employee in B.
  for (const [label, scope] of [
    ["hrA", A],
    ["hrB", B],
  ] as const) {
    await person(label, scope);
    await grant(u[label], ["jml.view", "jml.decideApprovals"], "COMPANY", scope.entityId);
  }
  // Decides approvals org-wide, but may only VIEW cases in A.
  await person("decider");
  await grant(u.decider, ["jml.decideApprovals"], "GROUP");
  await grant(u.decider, ["jml.view"], "COMPANY", A.entityId);
  const leaver = await person("leaverB", B);
  const leaverEmp = await prismaUnfiltered.employee.findUniqueOrThrow({
    where: { userId: leaver },
    select: { id: true },
  });
  const kase = await prismaUnfiltered.jmlCase.create({
    data: {
      caseRef: `${RUN}-L`.slice(0, 40),
      caseType: "LEAVE",
      stage: "STAGE_3_NOTICE_HANDOVER",
      status: "ACTIVE",
      employeeId: leaverEmp.id,
    },
    select: { id: true },
  });
  rec.caseB = kase.id;
  await prismaUnfiltered.jmlApproval.create({
    data: { caseId: kase.id, approvalType: "EXIT_CONFIRMATION", holderRoleKey: "HR_MANAGER" },
  });

  // Tickets: two pairs; a drafter on each; a ticket on pair 2.
  const p1 = await prismaUnfiltered.hrTagPair.create({
    data: { name: `${RUN} P1` },
    select: { id: true },
  });
  const p2 = await prismaUnfiltered.hrTagPair.create({
    data: { name: `${RUN} P2` },
    select: { id: true },
  });
  rec.p1 = p1.id;
  rec.p2 = p2.id;
  await person("drafter1");
  await grant(u.drafter1, ["tickets.draft"], "HR_PAIR", p1.id);
  await person("drafter2");
  await grant(u.drafter2, ["tickets.draft"], "HR_PAIR", p2.id);
  const t = await prismaUnfiltered.escalation.create({
    data: {
      hrPairId: p2.id,
      employeeName: "Someone",
      employeeEmail: email("asker"),
      question: "How many leave days do I have?",
    },
    select: { id: true },
  });
  rec.ticket = t.id;
});

after(async () => {
  if (!dbReachable) return;
  const quiet = (p: Promise<unknown>) => p.catch(() => {});
  await quiet(
    prismaUnfiltered.notification.deleteMany({
      where: {
        OR: [{ recipientUserId: { in: users } }, { recipientEmployeeId: { in: employees } }],
      },
    }),
  );
  if (rec.ticket) await quiet(prismaUnfiltered.escalation.delete({ where: { id: rec.ticket } }));
  await quiet(prismaUnfiltered.hrTagPair.deleteMany({ where: { id: { in: [rec.p1, rec.p2] } } }));
  if (rec.caseB) {
    await quiet(prismaUnfiltered.jmlApproval.deleteMany({ where: { caseId: rec.caseB } }));
    await quiet(prismaUnfiltered.jmlCase.delete({ where: { id: rec.caseB } }));
  }
  if (rec.ivB) {
    await quiet(
      prismaUnfiltered.hiringInterviewPanelist.deleteMany({ where: { interviewId: rec.ivB } }),
    );
    await quiet(prismaUnfiltered.hiringInterview.delete({ where: { id: rec.ivB } }));
  }
  if (rec.candB) await quiet(prismaUnfiltered.hiringCandidate.delete({ where: { id: rec.candB } }));
  if (rec.reqB) await quiet(prismaUnfiltered.hiringRequisition.delete({ where: { id: rec.reqB } }));
  await quiet(prismaUnfiltered.roleAssignment.deleteMany({ where: { userId: { in: users } } }));
  await quiet(prismaUnfiltered.accessRole.deleteMany({ where: { id: { in: roles } } }));
  await quiet(prismaUnfiltered.employee.deleteMany({ where: { id: { in: employees } } }));
  await quiet(prismaUnfiltered.user.deleteMany({ where: { id: { in: users } } }));
});

test("hiring: a notice about B's requisition reaches only people who can open it", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const key = `${RUN}:req`;
  await notifyUsers([u.hmA, u.hmB, u.hmGroup, u.cooA], {
    kind: "HIRING_APPROVAL_REQUESTED",
    module: "hiring",
    body: "A hiring request is waiting for your approval.",
    href: `/hiring/requisitions/${rec.reqB}/approval`,
    key,
  });
  assert.equal(await bell("hmB", key), 1, "B's hiring manager is told");
  assert.equal(await bell("hmGroup", key), 1, "an org-wide reader is told");
  assert.equal(await bell("hmA", key), 0, "A's hiring manager is NOT told about B");
  assert.equal(await bell("cooA", key), 0, "an approval role without B access is NOT told");
});

test("hiring: a scorecard notice reaches only panelists who can open the score page", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const key = `${RUN}:score`;
  await notifyUsers([u.hmA, u.hmB], {
    kind: "HIRING_SCORECARD_DUE",
    module: "hiring",
    body: "Score the candidate.",
    href: `/hiring/panel/${rec.ivB}/score`,
    key,
  });
  assert.equal(await bell("hmB", key), 1);
  assert.equal(await bell("hmA", key), 0, "a panelist out of scope cannot open the score page");
});

test("hiring My work: a panelist out of scope is not asked for a scorecard", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const listed = async (label: string) =>
    (await hiringWorkProvider.collect(sessionOf(label), new Date())).items.some(
      (i) => i.href === `/hiring/panel/${rec.ivB}/score`,
    );
  assert.equal(await listed("hmB"), true);
  assert.equal(await listed("hmA"), false);
});

test("JML: a case notice reaches HR in the case's company only", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const base = `${RUN}-case`;
  await notifyJml(
    [
      {
        kind: "JML_INFO",
        userIds: [u.hrA, u.hrB, u.decider],
        body: "A case needs attention.",
        href: `/jml/cases/${rec.caseB}`,
        caseId: rec.caseB,
        dedupeBase: base,
      },
    ],
    DEFAULT_CALENDAR,
  );
  assert.equal(await bell("hrB", base), 1);
  assert.equal(await bell("hrA", base), 0, "HR scoped to A is NOT told about B's case");
  assert.equal(await bell("decider", base), 0, "deciding approvals is not seeing the case");
});

test("JML: My tasks notices pass (the inbox lists only the viewer's own work)", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const open = await whoCanOpen("/jml/my-tasks", [u.hrA, u.hrB]);
  assert.deepEqual([...open].sort(), [u.hrA, u.hrB].sort());
});

test("JML My work: an approval is listed only where the case can be opened", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const listed = async (label: string) =>
    (await jmlWorkProvider.collect(sessionOf(label), new Date())).items.some(
      (i) => i.href === `/jml/cases/${rec.caseB}?tab=approvals`,
    );
  assert.equal(await listed("hrB"), true);
  assert.equal(await listed("hrA"), false);
  assert.equal(await listed("decider"), false, "decide-only, no view: the link would 404");
});

test("tickets: bell and email recipients are the pair's readers only", async (t) => {
  if (!dbReachable) return t.skip("no database");
  const href = `/tickets/${rec.ticket}`;
  // The email path asks the same question before it addresses anyone.
  const open = await whoCanOpen(href, [u.drafter1, u.drafter2]);
  assert.deepEqual([...open], [u.drafter2]);
  const key = `${RUN}:ticket`;
  await notifyUsers([u.drafter1, u.drafter2], {
    kind: "TICKET_TO_DRAFT",
    module: "tickets",
    body: "A ticket needs an answer.",
    href,
    key,
  });
  assert.equal(await bell("drafter2", key), 1);
  assert.equal(await bell("drafter1", key), 0, "a drafter on another pair is NOT told");
});

test("an unknown link under a covered module is refused (fail closed)", async (t) => {
  if (!dbReachable) return t.skip("no database");
  assert.equal((await whoCanOpen("/hiring/nowhere/x", [u.hmGroup])).size, 0);
  assert.equal((await whoCanOpen("/performance/x", [u.hmA])).size, 1, "outside the gate");
});
