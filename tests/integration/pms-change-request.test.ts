// DB-backed integration test for §6's mid-year change requests (Phase 3a).
//
// Drives the REAL route handlers with REAL wire payloads against a REAL local
// Postgres. That is the only way to exercise the three things the DB-free
// contract suite structurally cannot reach:
//
//   - the decide TRANSACTION (archive -> apply -> claim, all or nothing)
//   - the PARTIAL UNIQUE INDEX that makes a second pending request impossible
//   - §6.3's archive actually holding the SUPERSEDED state, not the new one
//
// NOT part of `npm test` -- CI only has a dummy DATABASE_URL. Run it explicitly:
//   npm run test:integration
//     (= node --experimental-test-module-mocks --import tsx --test tests/integration/*.test.ts)
// Load env first:  set -a; . ./.env; set +a
//
// The `before` hook BUILDS the §5.1 precondition (a cycle, an open mid-year
// stage, a 100% KPI set, HR's approval) on top of whatever the PMS seed left,
// and is re-runnable: a second run reuses the same logins and clears the
// requests it made last time. Both mutations were verified to fail this file:
// dropping the partial index fails the concurrency case, and archiving the
// post-change state instead of the superseded one fails the §6.3 case.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { NOT_SUITE_OWNED, NO_HR_ROLE, suiteActor, syncFixtureRoles } from "./fixture";
import { Prisma } from "../../generated/prisma/client";

const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};

let current: { user: { id: string; role: string; email?: string } } | null = null;

let prisma: typeof import("../../lib/prisma").prisma;
let submit: typeof import("../../app/api/kpi-change-requests/route");
let decide: typeof import("../../app/api/kpi-change-requests/[id]/decide/route");
let acknowledge: typeof import("../../app/api/kpi-change-requests/[id]/acknowledge/route");
let withdraw: typeof import("../../app/api/kpi-change-requests/[id]/withdraw/route");

const ids = {
  cycle: "",
  participant: "",
  employee: "",
  manager: "",
  managerUser: "",
  hr: "",
  hrUser: "",
  employeeUser: "",
  stranger: "",
  strangerUser: "",
  kpis: [] as string[],
};

/** A real Request, as the runtime would build it. */
const post = (url: string, body?: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

const as = (userId: string) => {
  current = { user: { id: userId, role: "USER" } };
};

/**
 * Unwrap the `{ data }` / `{ error }` envelope every route in this codebase
 * returns (`lib/api-response.ts`), so assertions read against the payload the
 * screens actually consume rather than against the wrapper.
 */
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
  // The REAL rate limiter runs. This makes ~10 write calls against a 30/minute
  // bucket, so nothing here is shaped by it — and stubbing it out would mean the
  // wrappers under test were not the ones that ship.

  ({ prisma } = await import("../../lib/prisma"));
  submit = await import("../../app/api/kpi-change-requests/route");
  decide = await import("../../app/api/kpi-change-requests/[id]/decide/route");
  acknowledge = await import("../../app/api/kpi-change-requests/[id]/acknowledge/route");
  withdraw = await import("../../app/api/kpi-change-requests/[id]/withdraw/route");

  // --- build the §5.1 precondition -----------------------------------------
  //
  // The seed produces the ORG (36 employees, three entities). §6 begins after a
  // cycle has run goal-setting to HR approval, so the harness drives that state
  // up through the real domain helpers where they exist. It is the precondition
  // under test, not the thing under test.
  const { enrolParticipants } = await import("../../lib/pms/cycle");

  const cycle = await prisma.performanceCycle.upsert({
    where: { year: 2099 },
    create: { year: 2099, status: "OPEN", openedAt: new Date() },
    update: { status: "OPEN" },
    select: { id: true },
  });
  ids.cycle = cycle.id;
  await enrolParticipants(ids.cycle);

  // A manager with at least one direct report, so §4.2 has something to permit.
  const manager = await prisma.employee.findFirstOrThrow({
    where: {
      status: "ACTIVE",
      ...NO_HR_ROLE,
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

  // A §5.3-complete set: three KPIs totalling exactly 100.
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
      ["Delivery", "40"],
      ["Quality", "35"],
      ["Collaboration", "25"],
    ] as const
  ).entries()) {
    const kpi = await prisma.kpi.create({
      data: {
        participantId: ids.participant,
        description: `${name} objective for 2099`,
        weightage: new Prisma.Decimal(weight),
        orderIndex: i,
        ...texts(name),
      },
      select: { id: true },
    });
    ids.kpis.push(kpi.id);
  }

  // A mid-year stage, open right now, so §5.4 lets the manager act.
  const now = Date.now();
  await prisma.cycleStage.upsert({
    where: { cycleId_kind: { cycleId: ids.cycle, kind: "MID_YEAR" } },
    create: {
      cycleId: ids.cycle,
      kind: "MID_YEAR",
      opensAt: new Date(now - 86_400_000),
      deadline: new Date(now + 86_400_000),
      graceDays: 3,
    },
    update: { opensAt: new Date(now - 86_400_000), deadline: new Date(now + 86_400_000) },
  });

  // Logins for the three actors. `resolveActor` links by userId first, so these
  // are written straight onto the employee rows.
  const login = async (employeeId: string, tag: string) => {
    const user = await prisma.user.upsert({
      where: { email: `verify-${tag}@example.test` },
      create: { email: `verify-${tag}@example.test`, name: `verify ${tag}`, role: "VIEWER" },
      update: {},
      select: { id: true },
    });
    // Detach first: `Employee.userId` is unique, and a previous run of this
    // harness may have linked this login to a different employee. Re-runnable
    // by construction, or the second run reports a constraint violation that
    // has nothing to do with the code under test.
    await prisma.employee.updateMany({
      where: { userId: user.id, NOT: { id: employeeId } },
      data: { userId: null },
    });
    await prisma.employee.update({ where: { id: employeeId }, data: { userId: user.id } });
    return user.id;
  };
  ids.managerUser = await login(ids.manager, "mgr");
  // §6.2 needs the SUBJECT to be able to act: they acknowledge before HR decides.
  ids.employeeUser = await login(ids.employee, "emp");

  // This suite owns its HR actor — see tests/integration/fixture.ts on why
  // borrowing the seeded Super Admin makes concurrent suites fail with a 403.
  ids.hr = await suiteActor(prisma, {
    suite: "cr",
    tag: "hr",
    name: "Change-request HR Super Admin",
    starterRoles: ["HR_SUPER_ADMIN"],
  });
  ids.hrUser = await login(ids.hr, "hr");

  // §5.1's lock — HR approves the baseline, which is what §6 exists to amend.
  // Unconditional: this harness owns the 2099 cycle it created above, so there
  // is no earlier approval to preserve, and re-approving is what makes the file
  // re-runnable.
  await prisma.cycleParticipant.update({
    where: { id: ids.participant },
    data: { goalsApprovedAt: new Date(), goalsApprovedById: ids.hr },
  });

  // Someone with no relationship to the subject at all — §4.2's 404 case.
  const stranger = await prisma.employee.findFirst({
    where: {
      ...NO_HR_ROLE,
      id: { notIn: [ids.manager, ids.employee, ids.hr] },
      NOT: { reports: { some: {} } },
      // Never another suite's own employee — see tests/integration/fixture.ts.
      ...NOT_SUITE_OWNED,
    },
    select: { id: true },
  });
  assert.ok(stranger, "fixture must contain an unrelated individual contributor");
  ids.stranger = stranger.id;
  ids.strangerUser = await login(stranger.id, "stranger");

  // Start from a clean slate so a re-run is meaningful.
  await prisma.kpiChangeRequest.deleteMany({ where: { participantId: ids.participant } });
  await prisma.kpiVersion.deleteMany({ where: { kpiId: { in: ids.kpis } } });
  // Authority is role assignments now: grant the actors' described starter roles (fixture.ts).
  await syncFixtureRoles(prisma);
});

after(async () => {
  await prisma.$disconnect();
});

// --- §4.2 -------------------------------------------------------------------

test("§4.2 a stranger gets 404, not 403 — no existence oracle", async () => {
  as(ids.strangerUser);
  const { status, error } = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "probing",
        edits: [{ kpiId: ids.kpis[0], descriptorTarget: "x" }],
      }),
      ctx(),
    ),
  );
  assert.equal(status, 404);
  assert.match(String(error), /not found/i);
});

// --- §5.3 at submission ------------------------------------------------------

test("§5.3 an unbalancing proposal is refused AT SUBMISSION, with the arithmetic", async () => {
  as(ids.managerUser);
  const kpis = await prisma.kpi.findMany({
    where: { id: { in: ids.kpis } },
    select: { id: true, weightage: true },
  });
  const first = kpis[0];
  const lower = first.weightage.minus(10).toString();

  const { status, error } = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "Scope reduced after the Q2 re-plan.",
        edits: [{ kpiId: first.id, weightage: lower }],
      }),
      ctx(),
    ),
  );
  assert.equal(status, 409);
  assert.match(String(error), /90%/);
  assert.match(String(error), /10%.*short/);
  assert.equal(
    await prisma.kpiChangeRequest.count({ where: { participantId: ids.participant } }),
    0,
    "a refused submission writes nothing",
  );
});

test("an edit that changes nothing is refused as noise, not stored", async () => {
  as(ids.managerUser);
  const live = await prisma.kpi.findUniqueOrThrow({
    where: { id: ids.kpis[0] },
    select: { descriptorTarget: true },
  });
  const { status, error } = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "no-op",
        edits: [{ kpiId: ids.kpis[0], descriptorTarget: live.descriptorTarget }],
      }),
      ctx(),
    ),
  );
  assert.equal(status, 400);
  assert.match(String(error), /change nothing/i);
});

// --- the happy path ----------------------------------------------------------

let requestId = "";

test("§6.2 a balanced request from the line manager is accepted and stored PENDING", async () => {
  as(ids.managerUser);
  const kpis = await prisma.kpi.findMany({
    where: { id: { in: ids.kpis } },
    select: { id: true, weightage: true },
    orderBy: { orderIndex: "asc" },
  });
  const [a, b] = kpis;
  const { status, body } = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "Q2 re-plan moved delivery weight onto the platform migration.",
        edits: [
          {
            kpiId: a.id,
            weightage: a.weightage.minus(10).toString(),
            descriptorTarget: "Revised target wording",
          },
          { kpiId: b.id, weightage: b.weightage.plus(10).toString() },
        ],
      }),
      ctx(),
    ),
  );
  assert.equal(status, 201);
  const cr = body.changeRequest as Record<string, unknown>;
  assert.equal(cr.status, "PENDING");
  assert.equal((cr.edits as unknown[]).length, 2);
  requestId = cr.id as string;

  // Nothing is applied yet — the baseline HR approved is untouched.
  const after = await prisma.kpi.findUniqueOrThrow({
    where: { id: a.id },
    select: { weightage: true },
  });
  assert.equal(
    after.weightage.toString(),
    a.weightage.toString(),
    "a PENDING request changes no KPI",
  );
});

test("the partial unique index refuses a SECOND pending request for the same participant", async () => {
  as(ids.managerUser);
  const { status, error } = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "a second, concurrent proposal",
        edits: [{ kpiId: ids.kpis[0], descriptorOutstanding: "Something else entirely" }],
      }),
      ctx(),
    ),
  );
  assert.equal(status, 409);
  assert.match(String(error), /already has a change request awaiting/i);
});

test("§6.2 the manager who raised it cannot decide it", async () => {
  as(ids.managerUser);
  const { status, error } = await json(
    await decide.POST(
      post(`/api/kpi-change-requests/${requestId}/decide`, { decision: "APPROVE" }),
      ctx({ id: requestId }),
    ),
  );
  assert.equal(status, 403);
  assert.match(String(error), /Only HR/i);
});

test("§6.2 a rejection without a reason is refused at the boundary", async () => {
  as(ids.hrUser);
  const { status, error } = await json(
    await decide.POST(
      post(`/api/kpi-change-requests/${requestId}/decide`, { decision: "REJECT" }),
      ctx({ id: requestId }),
    ),
  );
  assert.equal(status, 400);
  assert.match(String(error), /reason/i);
});

// --- §6.3 the archive --------------------------------------------------------

test("§6.2/§6.3 HR approves: edits apply, and the superseded state is archived", async () => {
  const before = await prisma.kpi.findMany({
    where: { id: { in: ids.kpis } },
    select: {
      id: true,
      description: true,
      weightage: true,
      descriptorTarget: true,
      orderIndex: true,
    },
    orderBy: { orderIndex: "asc" },
  });

  // §6.2 puts the EMPLOYEE's acknowledgment before HR's decision, and the
  // decide route enforces that order: without it, an approval needs a written
  // override reason instead. This fixture went straight to HR, so it started
  // failing the moment the acknowledgment guard landed — and nothing caught it,
  // because the integration suite is not part of `/ship`.
  as(ids.employeeUser);
  const ack = await json(
    await acknowledge.POST(
      post(`/api/kpi-change-requests/${requestId}/acknowledge`, {}),
      ctx({ id: requestId }),
    ),
  );
  assert.equal(ack.status, 200, "the subject acknowledges their own pending change");

  as(ids.hrUser);
  const { status, body } = await json(
    await decide.POST(
      post(`/api/kpi-change-requests/${requestId}/decide`, {
        decision: "APPROVE",
        reason: "Agreed with the re-plan.",
      }),
      ctx({ id: requestId }),
    ),
  );
  assert.equal(status, 200);
  assert.equal(body.applied, 2);
  assert.equal((body.changeRequest as Record<string, unknown>).status, "APPROVED");

  const after = await prisma.kpi.findMany({
    where: { id: { in: ids.kpis } },
    select: { id: true, weightage: true, descriptorTarget: true },
    orderBy: { orderIndex: "asc" },
  });
  assert.equal(after[0].weightage.toString(), before[0].weightage.minus(10).toString());
  assert.equal(after[1].weightage.toString(), before[1].weightage.plus(10).toString());
  assert.equal(after[0].descriptorTarget, "Revised target wording");

  // §5.3 still holds across the whole set after the change.
  const total = after.reduce(
    (sum, k) => sum.plus(k.weightage),
    after[0].weightage.minus(after[0].weightage),
  );
  assert.equal(total.toString(), "100", "the set still totals exactly 100 after approval");

  // Symmetry again, on the branch that carries the most: an approval names the
  // decider AND the reason, and both were previously `after`-only, so §6.2's
  // "who approved, and why" never reached `changes`.
  const decidedAudit = await prisma.auditLog.findFirst({
    where: { entityType: "KpiChangeRequest", entityId: requestId, action: "UPDATE" },
    orderBy: { timestamp: "desc" },
    select: { before: true, after: true, changes: true },
  });
  const decidedChanges = (decidedAudit?.changes ?? {}) as Record<string, unknown>;
  assert.deepEqual(decidedChanges.status, { from: "PENDING", to: "APPROVED" });
  assert.deepEqual(decidedChanges.decisionReason, {
    from: null,
    to: "Agreed with the re-plan.",
  });
  assert.ok(
    "decidedByEmployeeId" in decidedChanges,
    "who decided must be diffed, not merely present on one side",
  );
  assert.deepEqual(
    Object.keys((decidedAudit?.before ?? {}) as Record<string, unknown>).sort(),
    Object.keys((decidedAudit?.after ?? {}) as Record<string, unknown>).sort(),
  );

  // §6.3 — "previous versions archived, never overwritten".
  const versions = await prisma.kpiVersion.findMany({
    where: { kpiId: { in: ids.kpis } },
    select: {
      kpiId: true,
      versionNo: true,
      weightage: true,
      descriptorTarget: true,
      supersededByRequestId: true,
    },
  });
  assert.equal(versions.length, 2, "one snapshot per edited KPI");
  for (const v of versions) {
    assert.equal(v.versionNo, 1);
    assert.equal(
      v.supersededByRequestId,
      requestId,
      "the archive names the request that superseded it",
    );
    const original = before.find((b) => b.id === v.kpiId)!;
    assert.equal(
      v.weightage.toString(),
      original.weightage.toString(),
      "the snapshot is the PRE-change state",
    );
    assert.equal(v.descriptorTarget, original.descriptorTarget);
  }
});

test("§6.2 a decided request cannot be decided again", async () => {
  as(ids.hrUser);
  const { status, error } = await json(
    await decide.POST(
      post(`/api/kpi-change-requests/${requestId}/decide`, {
        decision: "REJECT",
        reason: "changed my mind",
      }),
      ctx({ id: requestId }),
    ),
  );
  assert.equal(status, 409);
  assert.match(String(error), /already approved/i);
});

test("a decided request frees the participant for a new one, and versionNo increments", async () => {
  as(ids.managerUser);
  const live = await prisma.kpi.findMany({
    where: { id: { in: ids.kpis } },
    select: { id: true },
    orderBy: { orderIndex: "asc" },
  });
  const created = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "Reword the Outstanding descriptor after the calibration briefing.",
        edits: [
          { kpiId: live[0].id, descriptorOutstanding: "Exceeds the revised target by 20% or more" },
        ],
      }),
      ctx(),
    ),
  );
  assert.equal(created.status, 201, JSON.stringify(created.error ?? created.body));
  const second = (created.body.changeRequest as Record<string, unknown>).id as string;

  // Acknowledged first, same as above — §6.2's order, not a courtesy.
  as(ids.employeeUser);
  const ack2 = await json(
    await acknowledge.POST(
      post(`/api/kpi-change-requests/${second}/acknowledge`, {}),
      ctx({ id: second }),
    ),
  );
  assert.equal(ack2.status, 200);

  as(ids.hrUser);
  const decided = await json(
    await decide.POST(
      post(`/api/kpi-change-requests/${second}/decide`, { decision: "APPROVE" }),
      ctx({ id: second }),
    ),
  );
  assert.equal(decided.status, 200, JSON.stringify(decided.error ?? decided.body));

  const versions = await prisma.kpiVersion.findMany({
    where: { kpiId: live[0].id },
    select: { versionNo: true },
    orderBy: { versionNo: "asc" },
  });
  assert.deepEqual(
    versions.map((v) => v.versionNo),
    [1, 2],
    "the archive appends, it never overwrites",
  );
});

// --- withdrawal --------------------------------------------------------------

test("a withdrawal is a STATUS, and it frees the pending slot", async () => {
  as(ids.managerUser);
  const created = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "Raised in error.",
        edits: [
          { kpiId: ids.kpis[0], descriptorUnsatisfactory: "Misses the revised target entirely" },
        ],
      }),
      ctx(),
    ),
  );
  assert.equal(created.status, 201, JSON.stringify(created.error ?? created.body));
  const third = (created.body.changeRequest as Record<string, unknown>).id as string;

  const pulled = await json(
    await withdraw.POST(post(`/api/kpi-change-requests/${third}/withdraw`), ctx({ id: third })),
  );
  assert.equal(pulled.status, 200);
  assert.equal((pulled.body.changeRequest as Record<string, unknown>).status, "WITHDRAWN");

  const row = await prisma.kpiChangeRequest.findUnique({
    where: { id: third },
    select: { status: true, edits: { select: { id: true } } },
  });
  assert.equal(row?.status, "WITHDRAWN", "the row survives — §6.3 wants what was ASKED");
  assert.equal(row?.edits.length, 1, "and the edits it proposed survive with it");

  // The audit row's two snapshots must carry the SAME keys. `recordAudit` diffs
  // only the keys both sides hold, so a field named on one side alone produces
  // no `changes` entry — the trail says an UPDATE happened and not what moved.
  // This route also used to claim `withdrawnByEmployeeId` in `after`; there is
  // no such column, so it asserted a fact the record could not hold.
  const pulledAudit = await prisma.auditLog.findFirst({
    where: { entityType: "KpiChangeRequest", entityId: third, action: "UPDATE" },
    orderBy: { timestamp: "desc" },
    select: { before: true, after: true, changes: true },
  });
  assert.deepEqual(
    pulledAudit?.changes,
    { status: { from: "PENDING", to: "WITHDRAWN" } },
    "the withdrawal must be legible as a status move, not as a bare UPDATE",
  );
  assert.deepEqual(
    Object.keys((pulledAudit?.before ?? {}) as Record<string, unknown>).sort(),
    Object.keys((pulledAudit?.after ?? {}) as Record<string, unknown>).sort(),
    "before and after must be symmetric, or the diff silently drops fields",
  );

  // The slot is free again.
  const next = await json(
    await submit.POST(
      post("/api/kpi-change-requests", {
        participantId: ids.participant,
        rationale: "Corrected version of the withdrawn request.",
        edits: [
          { kpiId: ids.kpis[0], descriptorUnsatisfactory: "Falls short of the revised target" },
        ],
      }),
      ctx(),
    ),
  );
  assert.equal(next.status, 201, "withdrawing frees the participant immediately");
  await withdraw.POST(
    post(
      `/api/kpi-change-requests/${(next.body.changeRequest as Record<string, unknown>).id}/withdraw`,
    ),
    ctx({ id: (next.body.changeRequest as Record<string, unknown>).id as string }),
  );
});

// --- listing -----------------------------------------------------------------

test("§4.2 the list is scoped by chain, not filtered after paging", async () => {
  const list = async () =>
    json(
      await submit.GET(
        new NextRequest(new URL("/api/kpi-change-requests", "http://localhost")),
        ctx(),
      ),
    );

  as(ids.strangerUser);
  const mine = await list();
  assert.equal(mine.status, 200);
  const strangerRows = (mine.body as unknown as { data: { participantId: string }[] }).data;
  assert.ok(
    strangerRows.every((row) => row.participantId !== ids.participant),
    "someone outside the chain sees nothing about this participant",
  );
  // What they MAY see is anything about themselves — §6.2 gives HR's reason to
  // the manager, and nothing in §6 makes a request confidential from its own
  // subject. A change to someone's goals that they cannot see is not a goal they
  // agreed to (§5.1). Asserted rather than assumed, because the alternative
  // reading is a leak and this is the line between them.
  const ownParticipant = await prisma.cycleParticipant.findFirst({
    where: { cycleId: ids.cycle, employeeId: ids.stranger },
    select: { id: true },
  });
  assert.ok(
    strangerRows.every((row) => row.participantId === ownParticipant?.id),
    "and everything they DO see is about themselves",
  );

  as(ids.managerUser);
  const managerRows = (await list()).body as unknown as { data: { participantId: string }[] };
  assert.ok(
    managerRows.data.some((row) => row.participantId === ids.participant),
    "the line manager sees their own report's requests",
  );

  as(ids.hrUser);
  const hrView = await list();
  assert.ok(
    (hrView.body as unknown as { total: number }).total >= 4,
    "HR sees the whole history, decided rows included",
  );
});
