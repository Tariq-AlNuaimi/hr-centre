// JML task routing (docs/blueprints/jml-task-routing.md) — the worst paths on a
// real database: a manager on another team's case → 404; a desk user on a
// settlement → 403; a worker may do the work but not the planning; the manager
// changes mid-case → open LINE_MANAGER tasks follow. Run with
//   npm run test:integration
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

import { prismaUnfiltered } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import { resolveActor } from "../../lib/pms/actor";
import { JmlError } from "../../lib/jml/errors";
import { updateTask } from "../../lib/jml/engine/task-update";
import { addComment } from "../../lib/jml/engine/tasks";
import { getSettlement } from "../../lib/jml/leave/settlement";
import { myTasks } from "../../lib/jml/dashboard";
import { reconcileLineManagerTasks } from "../../lib/jml/routing/assign";
import { saveDeskSettings } from "../../lib/jml/routing/desks";
import { TEST_EMPLOYEE_PREFIX } from "./fixture";

const RUN = `jr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const email = (l: string) => `${RUN}.${l}@example.test`;

let dbReachable = false;
let entityId = "";
let departmentId = "";
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  const d = await prismaUnfiltered.department.findFirstOrThrow({
    select: { id: true, entityId: true },
  });
  departmentId = d.id;
  entityId = d.entityId;
  dbReachable = true;
} catch {
  dbReachable = false;
}

const users: string[] = [];
const employees: string[] = [];
let caseId = "";
const ids: Record<string, string> = {};
let previousDesks: { IT: string[]; FINANCE: string[] } = { IT: [], FINANCE: [] };

async function person(label: string, managerId: string | null = null) {
  const user = await prismaUnfiltered.user.create({
    data: { email: email(label), name: `JR ${label}`, role: "VIEWER" },
    select: { id: true },
  });
  users.push(user.id);
  const emp = await prismaUnfiltered.employee.create({
    data: {
      odooId: `${TEST_EMPLOYEE_PREFIX}${RUN}-${label}`.slice(0, 60),
      name: `JR ${label}`,
      email: email(label),
      entityId,
      departmentId,
      managerId,
      roleTrack: "INDIVIDUAL",
      status: "ACTIVE",
      userId: user.id,
      dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
    },
    select: { id: true },
  });
  employees.push(emp.id);
  return { userId: user.id, employeeId: emp.id };
}

const actorOf = (userId: string, label: string) =>
  resolveActor({
    user: { id: userId, email: email(label), role: "VIEWER" },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } satisfies Session);

async function refusal(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof JmlError) return e.status;
    throw e;
  }
}

before(async () => {
  if (!dbReachable) return;
  const managerA = await person("mgrA");
  const managerB = await person("mgrB");
  const leaver = await person("leaver", managerA.employeeId);
  await person("other", managerB.employeeId);
  const desk = await person("desk");
  const outsider = await person("outsider");
  Object.assign(ids, {
    mgrA: managerA.userId,
    mgrAEmp: managerA.employeeId,
    mgrB: managerB.userId,
    mgrBEmp: managerB.employeeId,
    leaverEmp: leaver.employeeId,
    desk: desk.userId,
    outsider: outsider.userId,
  });
  const current = await prismaUnfiltered.jmlDeskMember.findMany({
    select: { desk: true, userId: true },
  });
  previousDesks = {
    IT: current.filter((r) => r.desk === "IT").map((r) => r.userId),
    FINANCE: current.filter((r) => r.desk === "FINANCE").map((r) => r.userId),
  };
  await withAuditContext({}, () =>
    saveDeskSettings({ IT: [...previousDesks.IT, desk.userId], FINANCE: previousDesks.FINANCE }),
  );
  const kase = await prismaUnfiltered.jmlCase.create({
    data: {
      caseRef: `EXIT-${RUN}`.slice(0, 40),
      caseType: "LEAVE",
      status: "ACTIVE",
      stage: "STAGE_3_NOTICE_HANDOVER",
      employeeId: leaver.employeeId,
    },
    select: { id: true },
  });
  caseId = kase.id;
  const task = (
    code: string,
    assigneeRole: "HR" | "IT" | "LINE_MANAGER",
    ownerUserId: string | null,
  ) =>
    prismaUnfiltered.jmlTask.create({
      data: {
        caseId,
        code,
        name: `Task ${code}`,
        stage: "STAGE_3_NOTICE_HANDOVER",
        assigneeRole,
        ownerUserId,
        dueDate: new Date(Date.UTC(2026, 11, 1)),
      },
      select: { id: true },
    });
  ids.hrTask = (await task("S3-01", "HR", null)).id;
  ids.lmTask = (await task("S3-02", "LINE_MANAGER", managerA.userId)).id;
  ids.lmTask2 = (await task("S1-07", "LINE_MANAGER", managerA.userId)).id;
  ids.itTask = (await task("S3-04", "IT", null)).id;
});

after(async () => {
  if (!dbReachable) return;
  await withAuditContext({}, () => saveDeskSettings(previousDesks)).catch(() => {});
  if (caseId) await prismaUnfiltered.jmlCase.delete({ where: { id: caseId } }).catch(() => {});
  await prismaUnfiltered.notification
    .deleteMany({ where: { recipientUserId: { in: users } } })
    .catch(() => {});
  await prismaUnfiltered.employee
    .updateMany({ where: { id: { in: employees } }, data: { managerId: null } })
    .catch(() => {});
  await prismaUnfiltered.employee.deleteMany({ where: { id: { in: employees } } }).catch(() => {});
  await prismaUnfiltered.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
});

test(
  "a manager on another team's case gets 404; their own report's LM task completes",
  { skip: !dbReachable },
  async () => {
    const other = await actorOf(ids.mgrB!, "mgrB");
    assert.equal(
      await refusal(
        withAuditContext({}, () => updateTask(other, ids.lmTask!, { status: "COMPLETED" })),
      ),
      404,
    );
    const mgr = await actorOf(ids.mgrA!, "mgrA");
    assert.equal(
      await refusal(
        withAuditContext({}, () => updateTask(mgr, ids.hrTask!, { status: "COMPLETED" })),
      ),
      403,
      "HR task on a case they participate in",
    );
    const done = await withAuditContext({}, () =>
      updateTask(mgr, ids.lmTask!, { status: "COMPLETED" }),
    );
    assert.equal(done.task.status, "COMPLETED");
    assert.equal(done.task.completedBy?.id, ids.mgrA);
  },
);

test(
  "a desk user completes the desk's task (recorded), but not the planning and not the settlement",
  { skip: !dbReachable },
  async () => {
    const desk = await actorOf(ids.desk!, "desk");
    assert.equal(await refusal(getSettlement(desk, caseId)), 403, "Restricted settlement → 403");
    assert.equal(
      await refusal(
        withAuditContext({}, () => updateTask(desk, ids.itTask!, { ownerUserId: ids.desk! })),
      ),
      403,
    );
    assert.equal(
      await refusal(
        withAuditContext({}, () =>
          updateTask(desk, ids.itTask!, { status: "NOT_APPLICABLE", notApplicableReason: "n/a" }),
        ),
      ),
      403,
    );
    const list = await myTasks(desk);
    assert.ok(
      list.some((t) => t.id === ids.itTask && t.canOpenCase === false),
      "routed into My tasks",
    );
    await withAuditContext({}, () => addComment(desk, ids.itTask!, "Revoked."));
    const done = await withAuditContext({}, () =>
      updateTask(desk, ids.itTask!, { status: "COMPLETED" }),
    );
    assert.equal(done.task.completedBy?.id, ids.desk);
  },
);

test("someone with no route to the case gets 404 everywhere", { skip: !dbReachable }, async () => {
  const outsider = await actorOf(ids.outsider!, "outsider");
  assert.equal(await refusal(getSettlement(outsider, caseId)), 404);
  assert.equal(
    await refusal(
      withAuditContext({}, () => updateTask(outsider, ids.itTask!, { status: "IN_PROGRESS" })),
    ),
    404,
  );
});

test(
  "D6: the manager changes mid-case → open LM tasks follow; the old manager loses them",
  { skip: !dbReachable },
  async () => {
    await prismaUnfiltered.employee.update({
      where: { id: ids.leaverEmp! },
      data: { managerId: ids.mgrBEmp! },
    });
    await withAuditContext({}, () => reconcileLineManagerTasks([ids.leaverEmp!]));
    const open = await prismaUnfiltered.jmlTask.findUniqueOrThrow({
      where: { id: ids.lmTask2! },
      select: { ownerUserId: true },
    });
    assert.equal(open.ownerUserId, ids.mgrB, "open task moved to the new manager");
    const closed = await prismaUnfiltered.jmlTask.findUniqueOrThrow({
      where: { id: ids.lmTask! },
      select: { ownerUserId: true, completedById: true },
    });
    assert.equal(closed.ownerUserId, ids.mgrA, "completed task keeps its history");
    const oldMgr = await actorOf(ids.mgrA!, "mgrA");
    assert.equal(
      await refusal(
        withAuditContext({}, () => updateTask(oldMgr, ids.lmTask2!, { status: "IN_PROGRESS" })),
      ),
      404,
    );
    const notice = await prismaUnfiltered.notification.findFirst({
      where: { recipientUserId: ids.mgrB!, kind: "JML_TASK_ASSIGNED" },
      select: { body: true },
    });
    assert.ok(notice, "the new manager is told");
  },
);
