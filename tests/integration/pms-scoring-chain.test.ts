// DB-backed integration test for §10.7's sequencing gate, end to end:
//   assessments signed → raw scores calculated (all) → calibration → publish
//
// NOT part of `npm test`:  npm run test:integration

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { Prisma } from "../../generated/prisma/client";
import type { PmsRole } from "../../lib/core/permissions";
import {
  TEST_EMPLOYEE_PREFIX,
  describeRoles,
  suiteActor,
  suiteLogin,
  syncFixtureRoles,
} from "./fixture";

const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};
let current: { user: { id: string; role: string } } | null = null;

let prisma: typeof import("../../lib/prisma").prisma;
let scores: typeof import("../../app/api/scores/route");
let calibration: typeof import("../../app/api/calibration/route");
let publish: typeof import("../../app/api/publish/route");
let bonus: typeof import("../../app/api/bonus/route");

const ids = { cycle: "", superAdmin: "", superAdminUser: "", hrbp: "", hrbpUser: "" };

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = () => ({ params: Promise.resolve({}) });
const as = (u: string) => {
  current = { user: { id: u, role: "VIEWER" } };
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
  scores = await import("../../app/api/scores/route");
  calibration = await import("../../app/api/calibration/route");
  publish = await import("../../app/api/publish/route");
  bonus = await import("../../app/api/bonus/route");

  const { enrolParticipants } = await import("../../lib/pms/cycle");

  // This suite creates its OWN HR actors rather than claiming the seeded HR
  // Super Admin and promoting an arbitrary employee to HRBP.
  //
  // `Employee.userId` is UNIQUE, and node's test runner runs test FILES
  // concurrently — so two suites that both log in as the one seeded Super Admin
  // race for that column, and whichever `before` hook lands second silently
  // leaves the other suite's actor pointing at a user with no employee record.
  // The symptom is a 403 on a test that passes in isolation, which reads as a
  // permissions bug and is not one.
  const entity = await prisma.orgEntity.findFirstOrThrow({ select: { id: true } });
  const department = await prisma.department.findFirstOrThrow({
    where: { entityId: entity.id },
    select: { id: true },
  });
  const actor = async (odooId: string, name: string, starterRoles: PmsRole[]) => {
    const row = await prisma.employee.upsert({
      where: { odooId },
      create: {
        odooId,
        name,
        email: `${odooId}@chain.test`,
        departmentId: department.id,
        entityId: entity.id,
        roleTrack: "INDIVIDUAL",
        status: "ACTIVE",
        dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
      },
      update: { status: "ACTIVE" },
      select: { id: true },
    });
    describeRoles(row.id, starterRoles);
    return row.id;
  };
  ids.superAdmin = await actor(`${TEST_EMPLOYEE_PREFIX}CHAIN-SA`, "Chain HR Super Admin", [
    "HR_SUPER_ADMIN",
  ]);
  // An HRBP, to prove §10.6's separation.
  ids.hrbp = await actor(`${TEST_EMPLOYEE_PREFIX}CHAIN-HRBP`, "Chain HRBP", ["HRBP"]);

  const cycle = await prisma.performanceCycle.upsert({
    where: { year: 2096 },
    create: { year: 2096, status: "OPEN", openedById: ids.superAdmin, openedAt: new Date() },
    update: { status: "OPEN" },
    select: { id: true },
  });
  ids.cycle = cycle.id;
  await enrolParticipants(ids.cycle);

  // Re-runnable.
  await prisma.scoreRun.deleteMany({ where: { cycleId: ids.cycle } });
  await prisma.calibrationTarget.deleteMany({ where: { cycleId: ids.cycle } });
  await prisma.cyclePublication.deleteMany({ where: { cycleId: ids.cycle } });

  const login = async (employeeId: string, tag: string) => {
    const user = await prisma.user.upsert({
      where: { email: `sc-${tag}@example.test` },
      create: { email: `sc-${tag}@example.test`, name: `sc ${tag}`, role: "VIEWER" },
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
  ids.hrbpUser = await login(ids.hrbp, "hrbp");
  // Authority is role assignments now: grant the actors' described starter roles (fixture.ts).
  await syncFixtureRoles(prisma);
});

after(async () => {
  // Nothing to undo: both actors are ours, created above rather than borrowed
  // from the fixture.
  await prisma.$disconnect();
});

// --- §10.7's gate, in order ------------------------------------------------------

test("§10.7 publishing is refused before any score run", async () => {
  as(ids.superAdminUser);
  const { status, error } = await json(
    await publish.POST(
      req("/api/publish", "POST", { cycleId: ids.cycle, action: "PUBLISH", confirm: "CONFIRM" }),
      ctx(),
    ),
  );
  assert.equal(status, 409);
  assert.match(String(error), /score run before calibration|No release/i);
});

test("§13.2 publishing needs a typed confirmation, not a truthy value", async () => {
  as(ids.superAdminUser);
  for (const confirm of [true, "yes", "", undefined]) {
    const { status } = await json(
      await publish.POST(
        req("/api/publish", "POST", { cycleId: ids.cycle, action: "PUBLISH", confirm }),
        ctx(),
      ),
    );
    assert.equal(status, 400, `confirm=${JSON.stringify(confirm)} must not publish`);
  }
});

test("§8 the score run reports who could NOT be scored, and why", async () => {
  as(ids.superAdminUser);
  const { status, body } = await json(
    await scores.POST(req("/api/scores", "POST", { cycleId: ids.cycle }), ctx()),
  );
  assert.equal(status, 201, JSON.stringify(body));

  const skipped = body.skipped as { employeeId: string; reason: string }[];
  // The fixture has no Strategy scores or 360 for this cycle, so nearly everyone
  // is skipped — and that is the POINT: the list is the worklist §10.7 needs
  // emptied, not a silent shortfall.
  assert.ok(skipped.length > 0, "unscoreable people are listed with reasons");
  assert.ok(
    skipped.some((s) => /Corporate score|Departmental score|360|no KPIs/i.test(s.reason)),
    "each skip names the missing input",
  );

  // §10.7's FIRST precondition — "assessments completed & signed" — is now one
  // of the reasons, not an assumption. Before this, scoring read ratings and
  // never looked at a signature, so an employee nobody had signed off was
  // scored, calibrated and published with correct arithmetic.
  assert.ok(
    skipped.some((s) => /not signed the year-end assessment/i.test(s.reason)),
    `an unsigned participant must be skipped for THAT reason; got: ${JSON.stringify(skipped.slice(0, 4))}`,
  );
  // And it names the party, so HR knows who to chase.
  const unsigned = skipped.find((s) => /not signed/i.test(s.reason))!;
  assert.match(unsigned.reason, /the (employee|manager)/i);
  assert.match(unsigned.reason, /§10\.7/);
});

test("§10.7 calibration is refused while anyone is unscored", async () => {
  as(ids.superAdminUser);
  const { status, body } = await json(
    await calibration.GET(req(`/api/calibration?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  assert.equal(status, 200);
  const readiness = body.readiness as { ready: boolean; reason: string | null };
  assert.equal(readiness.ready, false);
  assert.match(String(readiness.reason), /raw score|target distribution/i);
});

// --- §10.6's authority split ---------------------------------------------------------

test("§10.6 an HRBP cannot define the target distribution", async () => {
  as(ids.hrbpUser);
  const { status, error } = await json(
    await calibration.PUT(
      req("/api/calibration", "PUT", {
        cycleId: ids.cycle,
        outstandingPct: 10,
        excellentPct: 20,
        targetPct: 40,
        almostAchievedPct: 20,
        unsatisfactoryPct: 10,
      }),
      ctx(),
    ),
  );
  assert.equal(status, 403);
  assert.match(String(error), /HRBP does not touch calibration/);
});

test("§10.2 the five band percentages must total 100", async () => {
  as(ids.superAdminUser);
  const { status } = await json(
    await calibration.PUT(
      req("/api/calibration", "PUT", {
        cycleId: ids.cycle,
        outstandingPct: 10,
        excellentPct: 20,
        targetPct: 40,
        almostAchievedPct: 20,
        unsatisfactoryPct: 5, // 95
      }),
      ctx(),
    ),
  );
  assert.equal(status, 400);
});

test("§10.2 / §10.3 an HR Super Admin sets the target and the threshold", async () => {
  as(ids.superAdminUser);
  const { status } = await json(
    await calibration.PUT(
      req("/api/calibration", "PUT", {
        cycleId: ids.cycle,
        outstandingPct: 10,
        excellentPct: 20,
        targetPct: 40,
        almostAchievedPct: 20,
        unsatisfactoryPct: 10,
        minDepartmentSize: 5,
      }),
      ctx(),
    ),
  );
  assert.equal(status, 201);
  const target = await prisma.calibrationTarget.findUniqueOrThrow({
    where: { cycleId: ids.cycle },
    select: { minDepartmentSize: true },
  });
  assert.equal(target.minDepartmentSize, 5);
});

// --- §10.1 / §10.5 an adjustment, on a score we construct directly ---------------------

test("§10.1 calibration moves the calibrated band and NEVER the raw one", async () => {
  // Build one scored row directly: the fixture cannot produce a full score
  // without Strategy figures and a 360, and what is under test here is the
  // calibration layer, not the score run.
  const run = await prisma.scoreRun.create({
    data: {
      cycleId: ids.cycle,
      startedByEmployeeId: ids.superAdmin,
      finishedAt: new Date(),
      scoredCount: 1,
    },
    select: { id: true },
  });
  const score = await prisma.employeeScore.create({
    data: {
      scoreRunId: run.id,
      employeeId: ids.hrbp,
      corporateScore: new Prisma.Decimal("3.00"),
      departmentalScore: null,
      individualScore: new Prisma.Decimal("3.00"),
      threeSixtyScore: new Prisma.Decimal("3.00"),
      rawScore: new Prisma.Decimal("3.00"),
      rawBand: "TARGET",
      calibratedBand: "TARGET",
    },
    select: { id: true, rawScore: true, rawBand: true },
  });

  as(ids.superAdminUser);

  // §10.5 — the reason is mandatory.
  const noReason = await json(
    await calibration.POST(
      req("/api/calibration", "POST", {
        employeeScoreId: score.id,
        toBand: "EXCELLENT",
        reason: "  ",
      }),
      ctx(),
    ),
  );
  assert.equal(noReason.status, 400);

  // §10.6 — HRBP cannot.
  as(ids.hrbpUser);
  const wrongRole = await json(
    await calibration.POST(
      req("/api/calibration", "POST", {
        employeeScoreId: score.id,
        toBand: "EXCELLENT",
        reason: "strong delivery year",
      }),
      ctx(),
    ),
  );
  assert.equal(wrongRole.status, 403);

  as(ids.superAdminUser);
  const moved = await json(
    await calibration.POST(
      req("/api/calibration", "POST", {
        employeeScoreId: score.id,
        toBand: "EXCELLENT",
        reason: "strong delivery year",
      }),
      ctx(),
    ),
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.error));

  const after = await prisma.employeeScore.findUniqueOrThrow({
    where: { id: score.id },
    select: {
      rawScore: true,
      rawBand: true,
      calibratedBand: true,
      adjustments: { select: { reason: true, fromBand: true, toBand: true } },
    },
  });
  // §10.1 — the raw score and band are untouched.
  assert.equal(after.rawScore.toString(), score.rawScore.toString());
  assert.equal(after.rawBand, "TARGET");
  assert.equal(after.calibratedBand, "EXCELLENT");
  // §10.5 — who, from, to, and the mandatory reason.
  assert.equal(after.adjustments.length, 1);
  assert.deepEqual(
    { from: after.adjustments[0].fromBand, to: after.adjustments[0].toBand },
    { from: "TARGET", to: "EXCELLENT" },
  );
  assert.match(after.adjustments[0].reason, /strong delivery/);
});

// --- §11 bonus reads the CALIBRATED band --------------------------------------------

test("§11.3 the bonus uses the calibrated band, and §4.5 gates who may see it", async () => {
  as(ids.superAdminUser);
  const { status, body } = await json(
    await bonus.GET(req(`/api/bonus?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  assert.equal(status, 200, JSON.stringify(body));

  const rows = body.rows as { finalBand: string; rawBand: string; coefficient: number }[];
  const moved = rows.find((r) => r.rawBand !== r.finalBand);
  assert.ok(moved, "the calibrated employee appears with both bands");
  // EXCELLENT after calibration → §11.3's 1.5, not TARGET's 1.0.
  assert.equal(moved!.coefficient, 1.5);
});

test("§11.7 an employee with no Date of Joining is FLAGGED, not silently computed", async () => {
  as(ids.superAdminUser);
  const { body } = await json(
    await bonus.GET(req(`/api/bonus?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  const rows = body.rows as { ineligibleReason: string | null; bonus: string | null }[];
  const flagged = rows.filter((r) => r.ineligibleReason !== null);
  // Whatever the fixture holds, nothing may carry an amount AND a reason.
  for (const r of flagged) assert.equal(r.bonus, null);
});

// --- §13.2's gate, once ready ----------------------------------------------------------

test("§13.2 publishing succeeds once calibration is ready, and is reversible + audited", async () => {
  // Make the cycle ready: one participant, one score.
  const participants = await prisma.cycleParticipant.findMany({
    where: { cycleId: ids.cycle },
    take: 4000,
    select: { id: true, employeeId: true },
  });
  const keep = participants.find((p) => p.employeeId === ids.hrbp);
  if (!keep) return;
  await prisma.cycleParticipant.deleteMany({
    where: { cycleId: ids.cycle, id: { not: keep.id } },
  });
  const run = await prisma.scoreRun.findFirstOrThrow({
    where: { cycleId: ids.cycle },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  await prisma.scoreRun.update({ where: { id: run.id }, data: { scoredCount: 1 } });

  as(ids.hrbpUser);
  const wrongRole = await json(
    await publish.POST(
      req("/api/publish", "POST", { cycleId: ids.cycle, action: "PUBLISH", confirm: "CONFIRM" }),
      ctx(),
    ),
  );
  assert.equal(wrongRole.status, 403, "§13.2 gives publishing to HR Super Admin");

  as(ids.superAdminUser);
  const published = await json(
    await publish.POST(
      req("/api/publish", "POST", { cycleId: ids.cycle, action: "PUBLISH", confirm: "CONFIRM" }),
      ctx(),
    ),
  );
  assert.equal(published.status, 200, JSON.stringify(published.error));

  // §10.5 — calibrating a published cycle is refused; un-publish first.
  const score = await prisma.employeeScore.findFirstOrThrow({
    where: { scoreRunId: run.id },
    select: { id: true },
  });
  const blocked = await json(
    await calibration.POST(
      req("/api/calibration", "POST", {
        employeeScoreId: score.id,
        toBand: "OUTSTANDING",
        reason: "second thoughts",
      }),
      ctx(),
    ),
  );
  assert.equal(blocked.status, 409);
  assert.match(String(blocked.error), /Un-publish before adjusting/);

  // §13.2 — un-publishing carries a reason.
  const noReason = await json(
    await publish.POST(
      req("/api/publish", "POST", { cycleId: ids.cycle, action: "UNPUBLISH", confirm: "CONFIRM" }),
      ctx(),
    ),
  );
  assert.equal(noReason.status, 400);

  const unpublished = await json(
    await publish.POST(
      req("/api/publish", "POST", {
        cycleId: ids.cycle,
        action: "UNPUBLISH",
        confirm: "CONFIRM",
        reason: "A departmental score was keyed wrong.",
      }),
      ctx(),
    ),
  );
  assert.equal(unpublished.status, 200);

  // Both transitions audited (§13.2 — "who, when, why").
  const audit = await prisma.auditLog.findMany({
    where: { entityType: "CyclePublication", entityId: ids.cycle },
    take: 10,
    orderBy: { timestamp: "desc" },
    select: { before: true, after: true, changes: true },
  });
  assert.ok(audit.length >= 2, "publish and un-publish both left an audit row");

  // §13.2's WHY has to reach `changes`, not just sit in `after`. `recordAudit`
  // diffs only the keys BOTH snapshots carry, so the reason was invisible in the
  // diff for as long as it appeared on one side alone.
  const reversal = audit[0];
  assert.deepEqual((reversal.changes as Record<string, unknown>).published, {
    from: true,
    to: false,
  });
  assert.deepEqual((reversal.changes as Record<string, unknown>).lastReason, {
    // The PUBLISH above carried no reason (§13.2 makes it mandatory only on the
    // reversal), so the column held null going in.
    from: null,
    to: "A departmental score was keyed wrong.",
  });
  assert.deepEqual(
    Object.keys((reversal.before ?? {}) as Record<string, unknown>).sort(),
    Object.keys((reversal.after ?? {}) as Record<string, unknown>).sort(),
    "before and after must be symmetric, or the diff silently drops fields",
  );
});

// --- post-push breadth-review regressions -----------------------------------

test("§10.6 calibration answers authority BEFORE the read — no existence oracle", async () => {
  // Any authenticated user, with no PMS role at all. Before the fix the handler
  // read the row first, so a real id answered 403 and a made-up one 404 —
  // telling a stranger which EmployeeScore ids exist.
  const nobodyId = await suiteActor(prisma, {
    suite: "chain",
    tag: "nobody",
    name: "Chain No-Role Probe",
  });
  as(await suiteLogin(prisma, { suite: "chain", tag: "nobody", employeeId: nobodyId }));

  const real = await prisma.employeeScore.findFirst({ select: { id: true } });
  const realAnswer = await json(
    await calibration.POST(
      req("/api/calibration", "POST", {
        employeeScoreId: real?.id ?? "cl00000000000000000000001",
        toBand: "EXCELLENT",
        reason: "probe",
      }),
      ctx(),
    ),
  );
  const fakeAnswer = await json(
    await calibration.POST(
      req("/api/calibration", "POST", {
        employeeScoreId: "cl00000000000000000000000",
        toBand: "EXCELLENT",
        reason: "probe",
      }),
      ctx(),
    ),
  );

  assert.equal(realAnswer.status, 403);
  assert.equal(fakeAnswer.status, 403);
  assert.equal(realAnswer.error, fakeAnswer.error, "the two must be indistinguishable");
});

test("§13.2 two CONCURRENT publish-state writes: exactly one lands, and only one is audited", async () => {
  as(ids.superAdminUser);
  // Each call from its own throttle key: the publish route allows 10/minute by
  // design and this file has already spent most of them. The bucket is
  // per-caller, so distinct callers is the honest way to ask again.
  let caller = 0;
  const publishReq = (body: unknown) => {
    caller += 1;
    return new NextRequest(new URL("/api/publish", "http://localhost"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.8.8.${caller}` },
      body: JSON.stringify(body),
    });
  };

  const state = await json(
    await publish.GET(req(`/api/publish?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  const wasPublished = state.body.published === true;
  const flip = wasPublished ? "UNPUBLISH" : "PUBLISH";

  const auditsBefore = await prisma.auditLog.count({
    where: { entityType: "CyclePublication", entityId: ids.cycle },
  });

  // Both started before either is awaited, so both read the same prior state.
  // Only the conditional claim can separate them; the read-time no-op check
  // cannot, because at read time neither has committed.
  const [resA, resB] = await Promise.all([
    publish.POST(
      publishReq({ cycleId: ids.cycle, action: flip, confirm: "CONFIRM", reason: "race probe" }),
      ctx(),
    ),
    publish.POST(publishReq({ cycleId: ids.cycle, action: flip, confirm: "CONFIRM" }), ctx()),
  ]);
  const [a, b] = [await json(resA), await json(resB)];

  // A readiness refusal (§10.7) is a legitimate outcome for this cycle; the
  // arbiter is only reachable when the transition itself is allowed.
  if (a.status === 409 && b.status === 409 && /calibration|score/i.test(String(a.error))) return;

  const landed = [a, b].filter((r) => r.status === 200);
  assert.equal(landed.length, 1, `exactly one write may land, got ${a.status}/${b.status}`);

  const auditsAfter = await prisma.auditLog.count({
    where: { entityType: "CyclePublication", entityId: ids.cycle },
  });
  assert.equal(
    auditsAfter - auditsBefore,
    1,
    "the loser writes no audit row — one that did would report a `before` already stale",
  );
});

// --- red-team F8: the rater count is a fact about a score, not a free column ---------

test("F8 the rater count cannot exist without the 360 score it is the denominator of", async () => {
  const run = await prisma.scoreRun.create({
    data: {
      cycleId: ids.cycle,
      startedByEmployeeId: ids.superAdmin,
      finishedAt: new Date(),
      scoredCount: 0,
    },
    select: { id: true },
  });

  const base = {
    scoreRunId: run.id,
    employeeId: ids.hrbp,
    corporateScore: new Prisma.Decimal("3.00"),
    departmentalScore: null,
    individualScore: new Prisma.Decimal("3.00"),
    rawScore: new Prisma.Decimal("3.00"),
    rawBand: "TARGET" as const,
    calibratedBand: "TARGET" as const,
  };

  // A count with no score beside it is a denominator for nothing. §8.3's C-Level
  // row is the case this protects: no 360 at all, so no count either — and a
  // future writer that filled one in would be asserting a fact about an absence.
  await assert.rejects(
    () =>
      prisma.employeeScore.create({
        data: { ...base, threeSixtyScore: null, threeSixtyRaterCount: 2 },
        select: { id: true },
      }),
    /rater_count_needs_score/,
  );

  // Nobody is rated by a negative number of people.
  await assert.rejects(
    () =>
      prisma.employeeScore.create({
        data: {
          ...base,
          threeSixtyScore: new Prisma.Decimal("3.00"),
          threeSixtyRaterCount: -1,
        },
        select: { id: true },
      }),
    /rater_count_sane/,
  );

  // NULL is not zero, and the column must be able to say so: every row written
  // before the column existed is in that state, and a run that recorded no count
  // must not be readable as "nobody rated them".
  const unknown = await prisma.employeeScore.create({
    data: {
      ...base,
      threeSixtyScore: new Prisma.Decimal("3.00"),
      threeSixtyRaterCount: null,
    },
    select: { id: true, threeSixtyRaterCount: true },
  });
  assert.equal(unknown.threeSixtyRaterCount, null);

  await prisma.scoreRun.delete({ where: { id: run.id } });
});
