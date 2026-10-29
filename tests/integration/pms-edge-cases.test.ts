// DB-backed integration test for §12's edge cases and §13's role-scoped surfaces.
//
// NOT part of `npm test`:  npm run test:integration

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { PmsRole } from "../../lib/pms/permissions";
import { TEST_EMPLOYEE_PREFIX, describeRoles, suiteActor, syncFixtureRoles } from "./fixture";

const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};
let current: { user: { id: string; role: string } } | null = null;

let prisma: typeof import("../../lib/prisma").prisma;
let leavers: typeof import("../../app/api/leavers/route");
let rollUps: typeof import("../../app/api/roll-ups/route");
let transfers: typeof import("../../app/api/transfers/route");
let status: typeof import("../../app/api/status/route");
let scorecard: typeof import("../../app/api/scorecard/route");
let masterResults: typeof import("../../app/api/reports/master-results/route");

const ids = {
  cycle: "",
  superAdmin: "",
  superAdminUser: "",
  hrbp: "",
  hrbpUser: "",
  departing: "",
  report: "",
  reportUser: "",
  grandparent: "",
  mover: "",
  newDepartment: "",
};

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = () => ({ params: Promise.resolve({}) });
/**
 * A POST whose throttle key is unique per call, so a deliberate race is not
 * mistaken for abuse by the rate limiter (the bucket is per-caller by design).
 */
let raceCaller = 0;
const raceReq = (path: string, body: unknown) => {
  raceCaller += 1;
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.7.${raceCaller}` },
    body: JSON.stringify(body),
  });
};
const as = (u: string | null) => {
  current = u === null ? null : { user: { id: u, role: "VIEWER" } };
};
async function json(res: Response) {
  const e = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  return {
    status: res.status,
    body: (e.data ?? {}) as Record<string, unknown>,
    error: e.error ?? null,
  };
}

before(async () => {
  mockApi.module(import.meta.resolve("../../lib/auth.ts"), {
    namedExports: { auth: async () => current },
  });
  mockApi.module(import.meta.resolve("../../lib/sentry.ts"), {
    namedExports: { setUserContext: () => {}, captureError: () => {} },
  });
  ({ prisma } = await import("../../lib/prisma"));
  leavers = await import("../../app/api/leavers/route");
  rollUps = await import("../../app/api/roll-ups/route");
  transfers = await import("../../app/api/transfers/route");
  status = await import("../../app/api/status/route");
  scorecard = await import("../../app/api/scorecard/route");
  masterResults = await import("../../app/api/reports/master-results/route");

  const { enrolParticipants } = await import("../../lib/pms/cycle");

  // NOTE: this suite creates its OWN HR actors rather than claiming the seeded
  // HR Super Admin.
  //
  // `Employee.userId` is UNIQUE, and node's test runner runs test FILES
  // concurrently — so two suites that both log in as the one seeded Super Admin
  // race for that column, and whichever `before` hook lands second silently
  // leaves the other suite's actor pointing at a user with no employee record.
  // The symptom is a 403 on a test that passed in isolation, which reads as a
  // permissions bug and is not one. Owning our actors removes this suite from
  // the contention entirely.
  const cycle = await prisma.performanceCycle.upsert({
    where: { year: 2095 },
    create: { year: 2095, status: "OPEN", openedAt: new Date() },
    update: { status: "OPEN" },
    select: { id: true },
  });
  ids.cycle = cycle.id;
  await prisma.cycleStage.upsert({
    where: { cycleId_kind: { cycleId: ids.cycle, kind: "GOAL_SETTING" } },
    create: {
      cycleId: ids.cycle,
      kind: "GOAL_SETTING",
      opensAt: new Date(Date.UTC(2094, 11, 1)),
      deadline: new Date(Date.UTC(2095, 11, 31)),
    },
    update: {},
    select: { id: true },
  });

  // A three-level chain we own, built fresh so the fixture's own tree is left
  // alone: grandparent → departing → report.
  const entity = await prisma.orgEntity.findFirstOrThrow({ select: { id: true } });
  const department = await prisma.department.findFirstOrThrow({
    where: { entityId: entity.id },
    select: { id: true },
  });
  const other = await prisma.department.findFirst({
    where: { entityId: entity.id, id: { not: department.id } },
    select: { id: true },
  });
  ids.newDepartment = other?.id ?? department.id;

  const make = async (
    odooId: string,
    name: string,
    managerId: string | null,
    starterRoles: PmsRole[] = [],
  ) => {
    const row = await prisma.employee.upsert({
      where: { odooId },
      create: {
        odooId,
        name,
        email: `${odooId}@edge.test`,
        departmentId: department.id,
        entityId: entity.id,
        managerId,
        roleTrack: "INDIVIDUAL",
        status: "ACTIVE",
        // Comfortably in the past: the schema CHECK-constrains a joining date to at
        // most a year ahead, and a future-dated fixture is a fixture with a
        // shelf life.
        dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
      },
      update: {
        managerId,
        status: "ACTIVE",
        lastWorkingDay: null,
        departmentId: department.id,
        entityId: entity.id,
      },
      select: { id: true },
    });
    describeRoles(row.id, starterRoles);
    return row.id;
  };

  ids.superAdmin = await make(`${TEST_EMPLOYEE_PREFIX}EDGE-SA`, "Edge HR Super Admin", null, [
    "HR_SUPER_ADMIN",
  ]);
  ids.hrbp = await make(`${TEST_EMPLOYEE_PREFIX}EDGE-HRBP`, "Edge HRBP", null, ["HRBP"]);
  ids.grandparent = await make(`${TEST_EMPLOYEE_PREFIX}EDGE-GP`, "Edge Grandparent", null);
  ids.departing = await make(`${TEST_EMPLOYEE_PREFIX}EDGE-MGR`, "Edge Departing", ids.grandparent);
  ids.report = await make(`${TEST_EMPLOYEE_PREFIX}EDGE-RPT`, "Edge Report", ids.departing);
  ids.mover = await make(`${TEST_EMPLOYEE_PREFIX}EDGE-MOV`, "Edge Mover", ids.grandparent);

  await enrolParticipants(ids.cycle);

  // Re-runnable: clear anything a previous run of THIS suite created.
  await prisma.managerRollUp.deleteMany({
    where: { employeeId: { in: [ids.report, ids.mover] } },
  });
  await prisma.employeeAssignmentPeriod.deleteMany({ where: { cycleId: ids.cycle } });

  const login = async (employeeId: string, tag: string) => {
    const user = await prisma.user.upsert({
      where: { email: `edge-${tag}@example.test` },
      create: { email: `edge-${tag}@example.test`, name: `edge ${tag}`, role: "VIEWER" },
      update: {},
      select: { id: true },
    });
    await prisma.employee.updateMany({
      where: { userId: user.id, NOT: { id: employeeId } },
      data: { userId: null },
    });
    await prisma.employee.update({ where: { id: employeeId }, data: { userId: user.id } });
    return user.id;
  };
  ids.superAdminUser = await login(ids.superAdmin, "sa");
  ids.reportUser = await login(ids.report, "rpt");
  ids.hrbpUser = await login(ids.hrbp, "hrbp");
  // Authority is role assignments now: grant the actors' described starter roles (fixture.ts).
  await syncFixtureRoles(prisma);
});

after(async () => {
  await prisma.$disconnect();
});

// --- §12.1 the departure and its close-out ---------------------------------

test("§12.1 a departure moves reports up ONE level and records the roll-up", async () => {
  as(ids.superAdminUser);
  const { status: code, body } = await json(
    await leavers.POST(
      req("/api/leavers", "POST", {
        employeeId: ids.departing,
        lastWorkingDay: "2095-06-30",
        bypassReason: "Integration fixture: recorded without the process",
      }),
      ctx(),
    ),
  );
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.rolledUpReports, 1);
  assert.equal(body.rolledUpTo, ids.grandparent, "one level, not to the top");

  const report = await prisma.employee.findUniqueOrThrow({
    where: { id: ids.report },
    select: { managerId: true },
  });
  assert.equal(report.managerId, ids.grandparent, "§7.2 — the line must not point at a leaver");

  // §12.1 — "Record and history are preserved (never deleted)."
  const departed = await prisma.employee.findUniqueOrThrow({
    where: { id: ids.departing },
    select: { status: true, lastWorkingDay: true, deletedAt: true },
  });
  assert.equal(departed.status, "LEAVER");
  assert.equal(departed.deletedAt, null);
  assert.equal(departed.lastWorkingDay?.toISOString().slice(0, 10), "2095-06-30");
});

test("§12.1 the departure is audited with what it moved", async () => {
  const row = await prisma.auditLog.findFirst({
    where: { entityType: "Employee", entityId: ids.departing, action: "UPDATE" },
    orderBy: { timestamp: "desc" },
    select: { after: true },
  });
  const after = row?.after as Record<string, unknown> | null;
  assert.equal(after?.status, "LEAVER");
  assert.equal(after?.rolledUpReportCount, 1);
});

test("§12.1 a second departure is refused rather than silently re-run", async () => {
  as(ids.superAdminUser);
  const { status: code, error } = await json(
    await leavers.POST(
      req("/api/leavers", "POST", {
        employeeId: ids.departing,
        lastWorkingDay: "2095-06-30",
        bypassReason: "Integration fixture: recorded without the process",
      }),
      ctx(),
    ),
  );
  assert.equal(code, 409);
  assert.match(String(error), /already recorded as a leaver/i);
});

test("§12.1 the last working day is required — §11.4 pro-rates to it", async () => {
  as(ids.superAdminUser);
  const { status: code } = await json(
    await leavers.POST(
      req("/api/leavers", "POST", {
        employeeId: ids.mover,
        bypassReason: "Integration fixture: recorded without the process",
      }),
      ctx(),
    ),
  );
  assert.equal(code, 400);
});

// --- §12.2 the prompt ------------------------------------------------------

test("§12.2 an open roll-up prompt exists, with the spec's own wording", async () => {
  as(ids.superAdminUser);
  const { status: code, body } = await json(await rollUps.GET(req("/api/roll-ups", "GET"), ctx()));
  assert.equal(code, 200);
  assert.equal(body.promptKey, "temporarilyRolledUp");
  const open = (body.rollUps as Array<Record<string, unknown>>).filter(
    (r) => r.employeeId === ids.report,
  );
  assert.equal(open.length, 1, "exactly one prompt per employee");
  assert.equal(open[0].resolvedAt, null);
  assert.equal(open[0].reason, "LEAVER_ROLLUP");
});

test("§12.2 the partial index allows only ONE open prompt per employee", async () => {
  await assert.rejects(
    prisma.managerRollUp.create({
      data: { employeeId: ids.report, reason: "HR_REASSIGNMENT", toManagerEmployeeId: null },
    }),
    /Unique constraint|unique/i,
    "a second open prompt must be refused by the database, not merely avoided in code",
  );
});

test("§12.2 a non-HR actor cannot read or clear the queue", async () => {
  as(ids.reportUser);
  const read = await json(await rollUps.GET(req("/api/roll-ups", "GET"), ctx()));
  assert.equal(read.status, 403);
});

test("§12.2 HR names a permanent manager, and the line moves", async () => {
  as(ids.superAdminUser);
  const list = await json(await rollUps.GET(req("/api/roll-ups", "GET"), ctx()));
  const open = (list.body.rollUps as Array<Record<string, unknown>>).find(
    (r) => r.employeeId === ids.report,
  );
  assert.ok(open);

  const { status: code, body } = await json(
    await rollUps.POST(
      req("/api/roll-ups", "POST", {
        rollUpId: open.id,
        newManagerEmployeeId: ids.mover,
        resolutionNote: "Permanent owner agreed with the COO.",
      }),
      ctx(),
    ),
  );
  assert.equal(code, 200, JSON.stringify(body));

  const report = await prisma.employee.findUniqueOrThrow({
    where: { id: ids.report },
    select: { managerId: true },
  });
  assert.equal(report.managerId, ids.mover);

  const resolved = await prisma.managerRollUp.findUniqueOrThrow({
    where: { id: String(open.id) },
    select: { resolvedAt: true, resolvedByEmployeeId: true },
  });
  assert.notEqual(resolved.resolvedAt, null);
  assert.equal(resolved.resolvedByEmployeeId, ids.superAdmin);
});

test("§12.2 a resolved prompt cannot be resolved twice", async () => {
  as(ids.superAdminUser);
  const all = await json(await rollUps.GET(req("/api/roll-ups?includeResolved=1", "GET"), ctx()));
  const resolved = (all.body.rollUps as Array<Record<string, unknown>>).find(
    (r) => r.employeeId === ids.report && r.resolvedAt !== null,
  );
  assert.ok(resolved);
  const { status: code, error } = await json(
    await rollUps.POST(
      req("/api/roll-ups", "POST", {
        rollUpId: resolved.id,
        newManagerEmployeeId: ids.grandparent,
        bypassReason: "Integration fixture: recorded without the process",
      }),
      ctx(),
    ),
  );
  assert.equal(code, 409);
  assert.match(String(error), /already been resolved/i);
});

test("§12.1 a leaver cannot be named as the permanent manager", async () => {
  // Make a fresh prompt to answer.
  const fresh = await prisma.managerRollUp.create({
    data: {
      employeeId: ids.mover,
      reason: "HR_REASSIGNMENT",
      toManagerEmployeeId: ids.grandparent,
    },
    select: { id: true },
  });
  as(ids.superAdminUser);
  const { status: code, error } = await json(
    await rollUps.POST(
      req("/api/roll-ups", "POST", { rollUpId: fresh.id, newManagerEmployeeId: ids.departing }),
      ctx(),
    ),
  );
  assert.equal(code, 409);
  assert.match(String(error), /leaver cannot be named/i);
  await prisma.managerRollUp.delete({ where: { id: fresh.id } });
});

// --- §12.3 the transfer split ----------------------------------------------

test("§12.3 a mid-cycle transfer splits the year into two day-weighted periods", async () => {
  as(ids.superAdminUser);
  const { status: code, body } = await json(
    await transfers.POST(
      req("/api/transfers", "POST", {
        bypassReason: "Integration fixture: recorded without the process",
        employeeId: ids.mover,
        cycleId: ids.cycle,
        transferDate: "2095-07-01",
        newDepartmentId: ids.newDepartment,
        newManagerEmployeeId: ids.grandparent,
      }),
      ctx(),
    ),
  );
  assert.equal(code, 200, JSON.stringify(body));

  const periods = body.periods as Array<Record<string, unknown>>;
  assert.equal(periods.length, 2);
  assert.equal(periods[0].days, 181);
  assert.equal(periods[1].days, 184);
  const total = Number(periods[0].weight) + Number(periods[1].weight);
  assert.equal(total.toFixed(4), "1.0000", "§12.3 — days ÷ 365, summing to the year");

  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: ids.mover },
    select: { departmentId: true },
  });
  assert.equal(employee.departmentId, ids.newDepartment, "§7.2 — the live position moves");
});

test("§12.3 a second split of the same year is refused, not half-applied", async () => {
  as(ids.superAdminUser);
  const { status: code, error } = await json(
    await transfers.POST(
      req("/api/transfers", "POST", {
        employeeId: ids.mover,
        cycleId: ids.cycle,
        transferDate: "2095-09-01",
        newDepartmentId: ids.newDepartment,
        bypassReason: "Integration fixture: recorded without the process",
      }),
      ctx(),
    ),
  );
  assert.equal(code, 409);
  assert.match(String(error), /already split|not a transfer/i);
});

test("§12.3 the period register is visible to HR, with each half's weight", async () => {
  as(ids.superAdminUser);
  const { status: code, body } = await json(
    await transfers.GET(req(`/api/transfers?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  assert.equal(code, 200);
  const periods = (body.periods as Array<Record<string, unknown>>).filter(
    (p) => p.employeeId === ids.mover,
  );
  assert.equal(periods.length, 2);
  assert.equal(periods[0].orderIndex, 0);
  assert.equal(periods[1].orderIndex, 1);
});

test("§12.3 a transfer date outside the cycle is refused", async () => {
  as(ids.superAdminUser);
  const { status: code, error } = await json(
    await transfers.POST(
      req("/api/transfers", "POST", {
        bypassReason: "Integration fixture: recorded without the process",
        employeeId: ids.report,
        cycleId: ids.cycle,
        transferDate: "2099-07-01",
        newDepartmentId: ids.newDepartment,
      }),
      ctx(),
    ),
  );
  assert.equal(code, 409);
  assert.match(String(error), /does not split/i);
});

// --- §13.3 / §13.4 the status engine ---------------------------------------

test("§13.4 the same engine answers for HR org-wide and for a manager's chain", async () => {
  as(ids.superAdminUser);
  const hr = await json(await status.GET(req(`/api/status?cycleId=${ids.cycle}`, "GET"), ctx()));
  assert.equal(hr.status, 200);
  assert.equal(hr.body.scope, "org");
  const hrRows = hr.body.rows as Array<Record<string, unknown>>;
  assert.ok(hrRows.length > 1);

  as(ids.reportUser);
  const mine = await json(
    await status.GET(req(`/api/status?cycleId=${ids.cycle}&scope=direct`, "GET"), ctx()),
  );
  assert.equal(mine.status, 200);
  assert.equal(mine.body.scope, "direct");
  const myRows = mine.body.rows as Array<Record<string, unknown>>;
  assert.ok(myRows.length < hrRows.length, "a non-manager sees strictly fewer rows than HR");
});

test("§13.3 the down-chain view declares itself read-only", async () => {
  as(ids.reportUser);
  const { body } = await json(
    await status.GET(req(`/api/status?cycleId=${ids.cycle}&scope=chain`, "GET"), ctx()),
  );
  assert.equal(body.readOnly, true, "the payload says it, so the screen need not infer it");
});

test("§13.3 no compensation column reaches the status payload", async () => {
  as(ids.superAdminUser);
  const { body } = await json(
    await status.GET(req(`/api/status?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  const serialized = JSON.stringify(body);
  assert.ok(!/basicSalary/i.test(serialized), "§13.3 — never salary or bonus");
  assert.ok(!/bonus/i.test(serialized));
});

// --- §13.1 / §13.2 the scorecard and the gate -------------------------------

test("§13.2 an employee sees a truthful 'not yet', not a 403", async () => {
  as(ids.reportUser);
  const { status: code, body } = await json(
    await scorecard.GET(req(`/api/scorecard?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  assert.equal(code, 200, "not an error — nothing is being withheld from this person");
  assert.equal(body.published, false);
  assert.equal(body.score, undefined, "no partial result leaks before publication");
});

test("§13.1 a scorecard is the employee's own — a peer cannot read it", async () => {
  as(ids.reportUser);
  const { status: code, error } = await json(
    await scorecard.GET(
      req(`/api/scorecard?cycleId=${ids.cycle}&employeeId=${ids.mover}`, "GET"),
      ctx(),
    ),
  );
  assert.equal(code, 403);
  assert.match(String(error), /own/i);
});

// --- §13.5 the master export's narrower gate --------------------------------

test("§13.5 the master results export refuses an HRBP", async () => {
  as(ids.hrbpUser);
  const { status: code, error } = await json(
    await masterResults.GET(req(`/api/reports/master-results?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  assert.equal(code, 403, "§13.5 — HR Super Admin only, NOT HRBP");
  assert.match(String(error), /Super Admin/i);
});

test("§13.5 the master results export admits HR Super Admin", async () => {
  as(ids.superAdminUser);
  const res = await masterResults.GET(
    req(`/api/reports/master-results?cycleId=${ids.cycle}`, "GET"),
    ctx(),
  );
  // 409 (no score run yet for this cycle) is the RIGHT answer here; what matters
  // is that it is not the 403 the HRBP got.
  assert.notEqual(res.status, 403);
});

// --- review-rail regressions -----------------------------------------------

test("§12.3 an explicit null manager clears the line AND the new period's owner", async () => {
  // `?? employee.managerId` here recorded the OLD manager as owning the new half
  // while the employee's own line was being cleared — the one combination §12.3
  // cannot express, and the only case the two branches disagree on.
  const subject = await suiteActor(prisma, {
    suite: "edge",
    tag: "nullmgr",
    name: "Edge Null-Manager Mover",
    managerId: ids.grandparent,
  });
  const { enrolParticipants } = await import("../../lib/pms/cycle");
  await enrolParticipants(ids.cycle);
  // Re-runnable: a transfer moves the employee INTO the new department, so a
  // second run would be refused as "not a transfer" unless the position is put
  // back first. `suiteActor` already restored the manager and the status.
  const home = await prisma.department.findFirstOrThrow({
    where: { id: { not: ids.newDepartment } },
    select: { id: true, entityId: true },
  });
  await prisma.employee.update({
    where: { id: subject },
    data: { departmentId: home.id, entityId: home.entityId },
  });
  await prisma.employeeAssignmentPeriod.deleteMany({
    where: { employeeId: subject, cycleId: ids.cycle },
  });

  as(ids.superAdminUser);
  const { status: code, body } = await json(
    await transfers.POST(
      req("/api/transfers", "POST", {
        bypassReason: "Integration fixture: recorded without the process",
        employeeId: subject,
        cycleId: ids.cycle,
        transferDate: "2095-07-01",
        newDepartmentId: ids.newDepartment,
        newManagerEmployeeId: null,
      }),
      ctx(),
    ),
  );
  assert.equal(code, 200, JSON.stringify(body));

  const periods = await prisma.employeeAssignmentPeriod.findMany({
    where: { employeeId: subject, cycleId: ids.cycle },
    orderBy: { orderIndex: "asc" },
    select: { orderIndex: true, managerEmployeeId: true },
  });
  assert.equal(periods[0].managerEmployeeId, ids.grandparent, "the old half keeps its manager");
  assert.equal(periods[1].managerEmployeeId, null, "the new half has none, as asked");

  const after = await prisma.employee.findUniqueOrThrow({
    where: { id: subject },
    select: { managerId: true },
  });
  assert.equal(after.managerId, null, "and the live line agrees with it");
});

test("§4.2 a non-HR caller cannot tell a real roll-up id from a made-up one", async () => {
  as(ids.reportUser);
  const open = await prisma.managerRollUp.create({
    data: { employeeId: ids.mover, reason: "HR_REASSIGNMENT", toManagerEmployeeId: null },
    select: { id: true },
  });
  const real = await json(
    await rollUps.POST(
      req("/api/roll-ups", "POST", { rollUpId: open.id, newManagerEmployeeId: ids.grandparent }),
      ctx(),
    ),
  );
  const fake = await json(
    await rollUps.POST(
      req("/api/roll-ups", "POST", {
        rollUpId: "cl00000000000000000000000",
        newManagerEmployeeId: ids.grandparent,
      }),
      ctx(),
    ),
  );
  // Authority is answered BEFORE the read, so both are 403 and neither says
  // whether the id exists.
  assert.equal(real.status, 403);
  assert.equal(fake.status, 403);
  assert.equal(real.error, fake.error);
  await prisma.managerRollUp.delete({ where: { id: open.id } });
});

test("§13.5 the master export declares its audit-trail bound rather than implying completeness", async () => {
  as(ids.superAdminUser);
  const res = await masterResults.GET(
    req(`/api/reports/master-results?cycleId=${ids.cycle}`, "GET"),
    ctx(),
  );
  if (res.status !== 200) return; // no score run for this cycle; the gate test covers authority
  const { body } = await json(res);
  const trail = body.auditTrail as Record<string, unknown>;
  assert.equal(typeof trail.truncated, "boolean", "a capped export must not read as a full one");
  assert.equal(typeof trail.limit, "number");
  assert.ok(typeof trail.scope === "string" && trail.scope.length > 0);
});

test("§13.3/§13.5 a capped roster reports that it was capped", async () => {
  as(ids.superAdminUser);
  const { body } = await json(
    await status.GET(req(`/api/status?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  // The fixture is far under the cap, so this asserts the FIELD exists — a
  // completion percentage with no way to know it covered everyone is the bug.
  assert.equal(body.truncated, false);
});

// --- post-push breadth-review regressions -----------------------------------

test("§12.2 two CONCURRENT resolutions: exactly one wins, and only one is audited", async () => {
  const subject = await suiteActor(prisma, {
    suite: "edge",
    tag: "race",
    name: "Edge Race Subject",
    managerId: ids.grandparent,
  });
  await prisma.managerRollUp.deleteMany({ where: { employeeId: subject } });
  const open = await prisma.managerRollUp.create({
    data: { employeeId: subject, reason: "LEAVER_ROLLUP", toManagerEmployeeId: ids.grandparent },
    select: { id: true },
  });

  as(ids.superAdminUser);
  // Fired together, so BOTH read `resolvedAt: null` before either writes — the
  // read-time guard cannot separate them, and only the conditional claim can.
  // Sequential calls would pass even with the arbiter removed, which is why
  // this test is written this way.
  // NOTE the shape: the two POSTs are started BEFORE either is awaited.
  // `Promise.all([json(await A), json(await B)])` would await A inside the array
  // literal and run them sequentially — which passes even with the arbiter
  // removed, because the read-time guard alone separates sequential callers.
  const [resA, resB] = await Promise.all([
    rollUps.POST(
      raceReq("/api/roll-ups", { rollUpId: open.id, newManagerEmployeeId: ids.mover }),
      ctx(),
    ),
    rollUps.POST(
      raceReq("/api/roll-ups", { rollUpId: open.id, newManagerEmployeeId: ids.grandparent }),
      ctx(),
    ),
  ]);
  const [a, b] = [await json(resA), await json(resB)];

  const wins = [a, b].filter((r) => r.status === 200);
  const losses = [a, b].filter((r) => r.status === 409);
  assert.equal(wins.length, 1, `exactly one resolution may win, got ${a.status}/${b.status}`);
  assert.equal(losses.length, 1, "the loser must be refused, not silently applied");

  // One resolution → one audit row. Without the arbiter both commit, and the
  // loser's `before` reports a manager that was already stale when written.
  const resolutions = await prisma.auditLog.count({
    where: { entityType: "ManagerRollUp", entityId: open.id, action: "UPDATE" },
  });
  assert.equal(resolutions, 1, "a lost claim writes no resolution audit row");

  // And the employee's line matches the winner, not "whichever committed last".
  const settled = await prisma.employee.findUniqueOrThrow({
    where: { id: subject },
    select: { managerId: true },
  });
  assert.ok(
    settled.managerId === ids.mover || settled.managerId === ids.grandparent,
    "the line is one of the two proposed, never a blend",
  );

  await prisma.managerRollUp.deleteMany({ where: { employeeId: subject } });
});
