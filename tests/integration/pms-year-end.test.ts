// DB-backed integration test for §7.1's year-end assessment (Phase 3b).
//
// Drives the REAL route handlers with REAL wire payloads against a REAL local
// Postgres. NOT part of `npm test` -- CI only has a dummy DATABASE_URL:
//   npm run test:integration
// Load env first:  set -a; . ./.env; set +a
//
// The `before` hook builds the §5.1 precondition (cycle, open YEAR_END stage,
// a 100% KPI set, HR's approval) and is re-runnable.

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { NOT_SUITE_OWNED, suiteActor } from "./fixture";
import { Prisma } from "../../generated/prisma/client";

const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};

let current: { user: { id: string; role: string } } | null = null;

let prisma: typeof import("../../lib/prisma").prisma;
let ratings: typeof import("../../app/api/kpi-ratings/route");
let signoffs: typeof import("../../app/api/year-end-signoffs/route");

const ids = {
  cycle: "",
  participant: "",
  employee: "",
  manager: "",
  employeeUser: "",
  managerUser: "",
  hr: "",
  hrUser: "",
  stranger: "",
  strangerUser: "",
  kpis: [] as string[],
};

const post = (url: string, body?: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const as = (userId: string) => {
  current = { user: { id: userId, role: "VIEWER" } };
};

async function json(res: Response) {
  const envelope = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  return {
    status: res.status,
    body: (envelope.data ?? {}) as Record<string, unknown>,
    error: envelope.error ?? null,
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
  ratings = await import("../../app/api/kpi-ratings/route");
  signoffs = await import("../../app/api/year-end-signoffs/route");

  const { enrolParticipants } = await import("../../lib/pms/cycle");

  const cycle = await prisma.performanceCycle.upsert({
    where: { year: 2098 },
    create: { year: 2098, status: "OPEN", openedAt: new Date() },
    update: { status: "OPEN" },
    select: { id: true },
  });
  ids.cycle = cycle.id;
  await enrolParticipants(ids.cycle);

  const now = Date.now();
  await prisma.cycleStage.upsert({
    where: { cycleId_kind: { cycleId: ids.cycle, kind: "YEAR_END" } },
    create: {
      cycleId: ids.cycle,
      kind: "YEAR_END",
      opensAt: new Date(now - 86_400_000),
      deadline: new Date(now + 86_400_000),
      graceDays: 3,
    },
    update: { opensAt: new Date(now - 86_400_000), deadline: new Date(now + 86_400_000) },
  });

  const manager = await prisma.employee.findFirstOrThrow({
    where: {
      status: "ACTIVE",
      pmsRoles: { isEmpty: true },
      reports: { some: { status: "ACTIVE", roleTrack: { not: "C_LEVEL" } } },
      // Never another suite's own employee — see tests/integration/fixture.ts.
      ...NOT_SUITE_OWNED,
    },
    select: {
      id: true,
      reports: {
        where: { status: "ACTIVE", roleTrack: { not: "C_LEVEL" } },
        select: { id: true },
        take: 1,
      },
    },
  });
  ids.manager = manager.id;
  ids.employee = manager.reports[0].id;

  const participant = await prisma.cycleParticipant.findFirstOrThrow({
    where: { cycleId: ids.cycle, employeeId: ids.employee },
    select: { id: true },
  });
  ids.participant = participant.id;

  await prisma.kpiRating.deleteMany({ where: { kpi: { participantId: ids.participant } } });
  await prisma.signOff.deleteMany({ where: { participantId: ids.participant } });
  await prisma.kpi.deleteMany({ where: { participantId: ids.participant } });

  const texts = (n: string) => ({
    descriptorOutstanding: `${n}: far exceeds`,
    descriptorExcellent: `${n}: exceeds`,
    descriptorTarget: `${n}: meets`,
    descriptorAlmostAchieved: `${n}: nearly meets`,
    descriptorUnsatisfactory: `${n}: falls short`,
  });
  for (const [i, [name, weight]] of (
    [
      ["Delivery", "50"],
      ["Quality", "50"],
    ] as const
  ).entries()) {
    const kpi = await prisma.kpi.create({
      data: {
        participantId: ids.participant,
        description: `${name} objective for 2098`,
        weightage: new Prisma.Decimal(weight),
        orderIndex: i,
        ...texts(name),
      },
      select: { id: true },
    });
    ids.kpis.push(kpi.id);
  }

  const login = async (employeeId: string, tag: string) => {
    const user = await prisma.user.upsert({
      where: { email: `ye-${tag}@example.test` },
      create: { email: `ye-${tag}@example.test`, name: `ye ${tag}`, role: "VIEWER" },
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
  ids.employeeUser = await login(ids.employee, "emp");
  ids.managerUser = await login(ids.manager, "mgr");

  // This suite owns its HR actor — see tests/integration/fixture.ts on why
  // borrowing the seeded Super Admin makes concurrent suites fail with a 403.
  ids.hr = await suiteActor(prisma, {
    suite: "ye",
    tag: "hr",
    name: "Year-end HR Super Admin",
    pmsRoles: ["HR_SUPER_ADMIN"],
  });
  ids.hrUser = await login(ids.hr, "hr");

  const stranger = await prisma.employee.findFirstOrThrow({
    where: {
      pmsRoles: { isEmpty: true },
      id: { notIn: [ids.manager, ids.employee, ids.hr] },
      NOT: { reports: { some: {} } },
      // Never another suite's own employee — see tests/integration/fixture.ts.
      ...NOT_SUITE_OWNED,
    },
    select: { id: true },
  });
  ids.stranger = stranger.id;
  ids.strangerUser = await login(stranger.id, "stranger");

  // §5.1's lock — the baseline §7.1 assesses against.
  await prisma.cycleParticipant.update({
    where: { id: ids.participant },
    data: { goalsApprovedAt: new Date(), goalsApprovedById: ids.hr },
  });
});

after(async () => {
  await prisma.$disconnect();
});

const rate = (body: unknown) => ratings.POST(post("/api/kpi-ratings", body), ctx());
const sign = (body: unknown) => signoffs.POST(post("/api/year-end-signoffs", body), ctx());

// --- §7.1's ORDER ---------------------------------------------------------------

test("§7.1 the manager cannot review a KPI nobody has self-assessed", async () => {
  as(ids.managerUser);
  const { status, error } = await json(
    await rate({ kpiId: ids.kpis[0], party: "MANAGER", level: 3 }),
  );
  assert.equal(status, 409);
  assert.match(String(error), /not been self-assessed/i);
});

test("§4.2 a stranger rating gets 404, not 403", async () => {
  as(ids.strangerUser);
  const { status } = await json(await rate({ kpiId: ids.kpis[0], party: "EMPLOYEE", level: 3 }));
  assert.equal(status, 404);
});

test("§7.1 nobody self-assesses on the employee's behalf", async () => {
  as(ids.managerUser);
  assert.equal(
    (await json(await rate({ kpiId: ids.kpis[0], party: "EMPLOYEE", level: 4 }))).status,
    404,
  );
  as(ids.hrUser);
  assert.equal(
    (await json(await rate({ kpiId: ids.kpis[0], party: "EMPLOYEE", level: 4 }))).status,
    404,
  );
});

test("§8.1 a level outside 1-5 is refused at the boundary", async () => {
  as(ids.employeeUser);
  for (const level of [0, 6, 3.5]) {
    const { status } = await json(await rate({ kpiId: ids.kpis[0], party: "EMPLOYEE", level }));
    assert.equal(status, 400, `level ${level} must be refused`);
  }
});

test("§7.1 the employee self-assesses, and the set state comes back with it", async () => {
  as(ids.employeeUser);
  const first = await json(await rate({ kpiId: ids.kpis[0], party: "EMPLOYEE", level: 4 }));
  assert.equal(first.status, 201);
  assert.equal((first.body.state as { employeeRated: number }).employeeRated, 1);
  assert.equal((first.body.state as { complete: boolean }).complete, false);

  const second = await json(await rate({ kpiId: ids.kpis[1], party: "EMPLOYEE", level: 3 }));
  assert.equal(second.status, 201);
  assert.equal((second.body.state as { employeeRated: number }).employeeRated, 2);
});

test("re-rating UPDATES rather than appending — one assessment each (§7.1)", async () => {
  as(ids.employeeUser);
  const again = await json(await rate({ kpiId: ids.kpis[0], party: "EMPLOYEE", level: 5 }));
  assert.equal(again.status, 200, "an update, not a create");
  const rows = await prisma.kpiRating.findMany({
    where: { kpiId: ids.kpis[0], party: "EMPLOYEE" },
    select: { level: true },
  });
  assert.equal(rows.length, 1, "still exactly one row");
  assert.equal(rows[0].level, 5);
});

// --- the divergence rule (operator decision) ------------------------------------

test("a manager rating differently with no reason is refused", async () => {
  as(ids.managerUser);
  const { status, error } = await json(
    await rate({ kpiId: ids.kpis[0], party: "MANAGER", level: 2 }),
  );
  assert.equal(status, 409);
  assert.match(String(error), /lower/);
  assert.match(String(error), /Say why/i);
  assert.equal(
    await prisma.kpiRating.count({ where: { kpiId: ids.kpis[0], party: "MANAGER" } }),
    0,
    "and nothing is written",
  );
});

test("…with a reason it is accepted, and the reason is stored", async () => {
  as(ids.managerUser);
  const { status } = await json(
    await rate({
      kpiId: ids.kpis[0],
      party: "MANAGER",
      level: 2,
      comment: "Two Sev-1 regressions shipped in Q3.",
    }),
  );
  assert.equal(status, 201);
  const row = await prisma.kpiRating.findUniqueOrThrow({
    where: { kpiId_party: { kpiId: ids.kpis[0], party: "MANAGER" } },
    select: { level: true, comment: true },
  });
  assert.equal(row.level, 2);
  assert.match(row.comment as string, /Sev-1/);
});

test("agreeing needs no reason", async () => {
  as(ids.managerUser);
  const { status } = await json(await rate({ kpiId: ids.kpis[1], party: "MANAGER", level: 3 }));
  assert.equal(status, 201);
});

// --- §7.1's signatures ------------------------------------------------------------

test("§7.1 signing is refused until every KPI carries both ratings", async () => {
  // Wipe one manager rating so the set is incomplete again.
  await prisma.kpiRating.deleteMany({ where: { kpiId: ids.kpis[1], party: "MANAGER" } });
  as(ids.employeeUser);
  const { status, error } = await json(
    await sign({ participantId: ids.participant, party: "EMPLOYEE" }),
  );
  assert.equal(status, 409);
  assert.match(String(error), /1 of 2/);

  as(ids.managerUser);
  await json(await rate({ kpiId: ids.kpis[1], party: "MANAGER", level: 3 }));
});

test("§7.1 both parties sign a complete assessment", async () => {
  as(ids.employeeUser);
  const emp = await json(await sign({ participantId: ids.participant, party: "EMPLOYEE" }));
  assert.equal(emp.status, 201);

  as(ids.managerUser);
  const mgr = await json(await sign({ participantId: ids.participant, party: "MANAGER" }));
  assert.equal(mgr.status, 201);
  assert.deepEqual((mgr.body.signedParties as string[]).sort(), ["EMPLOYEE", "MANAGER"]);
});

test("signing twice is idempotent, not an error", async () => {
  as(ids.employeeUser);
  const again = await json(await sign({ participantId: ids.participant, party: "EMPLOYEE" }));
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadySigned, true);
});

test("HR cannot sign in the line manager's place", async () => {
  await prisma.signOff.deleteMany({ where: { participantId: ids.participant, party: "MANAGER" } });
  as(ids.hrUser);
  const { status, error } = await json(
    await sign({ participantId: ids.participant, party: "MANAGER" }),
  );
  assert.equal(status, 403);
  assert.match(String(error), /cannot sign in their place/i);
});

test("the year-end signature does NOT collide with a goal-setting one (Phase 3a's stageKind)", async () => {
  // The whole reason `SignOff` gained `stageKind`. Both pairs must co-exist.
  await prisma.signOff.create({
    data: {
      participantId: ids.participant,
      stageKind: "GOAL_SETTING",
      party: "EMPLOYEE",
      signedByEmployeeId: ids.employee,
    },
  });
  const rows = await prisma.signOff.findMany({
    where: { participantId: ids.participant, party: "EMPLOYEE" },
    select: { stageKind: true },
  });
  assert.equal(rows.length, 2, "one signature per stage, on the same participant and party");
  assert.deepEqual(rows.map((r) => r.stageKind).sort(), ["GOAL_SETTING", "YEAR_END"]);
});
