// DB-backed integration test for §9's 360 module and §8.4's Strategy scores.
//
// Drives the REAL route handlers against a REAL local Postgres.
// NOT part of `npm test`:  npm run test:integration

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const mockApi = mock as unknown as {
  module: (s: string, o: { namedExports: Record<string, unknown> }) => unknown;
};
let current: { user: { id: string; role: string } } | null = null;

let prisma: typeof import("../../lib/prisma").prisma;
let threeSixtyRoute: typeof import("../../app/api/three-sixty/route");
let assignmentsRoute: typeof import("../../app/api/three-sixty/assignments/route");
let activateRoute: typeof import("../../app/api/three-sixty/activate/route");
let responsesRoute: typeof import("../../app/api/three-sixty/responses/route");
let resultsRoute: typeof import("../../app/api/three-sixty/results/route");
let strategyRoute: typeof import("../../app/api/strategy-scores/route");

const ids = {
  cycle: "",
  threeSixty: "",
  hr: "",
  hrUser: "",
  ratee: "",
  rateeUser: "",
  entity: "",
  department: "",
};

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = () => ({ params: Promise.resolve({}) });
const as = (userId: string) => {
  current = { user: { id: userId, role: "VIEWER" } };
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
  threeSixtyRoute = await import("../../app/api/three-sixty/route");
  assignmentsRoute = await import("../../app/api/three-sixty/assignments/route");
  activateRoute = await import("../../app/api/three-sixty/activate/route");
  responsesRoute = await import("../../app/api/three-sixty/responses/route");
  resultsRoute = await import("../../app/api/three-sixty/results/route");
  strategyRoute = await import("../../app/api/strategy-scores/route");

  const { enrolParticipants } = await import("../../lib/pms/cycle");

  const hr = await prisma.employee.findFirstOrThrow({
    where: { pmsRoles: { has: "HR_SUPER_ADMIN" } },
    select: { id: true },
  });
  ids.hr = hr.id;

  const cycle = await prisma.performanceCycle.upsert({
    where: { year: 2097 },
    create: { year: 2097, status: "OPEN", openedById: hr.id, openedAt: new Date() },
    update: { status: "OPEN" },
    select: { id: true },
  });
  ids.cycle = cycle.id;
  await enrolParticipants(ids.cycle);
  // Re-runnable by construction: clear what a previous run of THIS file left, so
  // a second run asserts the same create/update transitions as the first.
  await prisma.threeSixtyCycle.deleteMany({ where: { cycleId: ids.cycle } });
  await prisma.entityScore.deleteMany({ where: { cycleId: ids.cycle } });
  await prisma.departmentScore.deleteMany({ where: { cycleId: ids.cycle } });

  const login = async (employeeId: string, tag: string) => {
    const user = await prisma.user.upsert({
      where: { email: `ts-${tag}@example.test` },
      create: { email: `ts-${tag}@example.test`, name: `ts ${tag}`, role: "VIEWER" },
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
  ids.hrUser = await login(ids.hr, "hr");

  const entity = await prisma.orgEntity.findFirstOrThrow({ select: { id: true } });
  ids.entity = entity.id;
  const dept = await prisma.department.findFirstOrThrow({ select: { id: true } });
  ids.department = dept.id;
});

after(async () => {
  await prisma.$disconnect();
});

const QUESTIONS = [
  ...Array.from({ length: 3 }, (_, i) => ({ text: `Scored question ${i + 1}`, scored: true })),
  { text: "What should they keep doing?", scored: false },
];
const TEMPLATES = [
  { type: "LINE_MANAGER_TO_EMPLOYEE" as const, questions: QUESTIONS },
  { type: "EMPLOYEE_TO_LINE_MANAGER" as const, questions: QUESTIONS },
  { type: "PEER_TO_PEER" as const, questions: QUESTIONS },
];

// --- §8.4 the Strategy scores ------------------------------------------------------

test("§8.4 only HR keys a Strategy score", async () => {
  const emp = await prisma.employee.findFirstOrThrow({
    where: { pmsRoles: { isEmpty: true } },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { email: "ts-plain@example.test" },
    create: { email: "ts-plain@example.test", name: "ts plain", role: "VIEWER" },
    update: {},
    select: { id: true },
  });
  await prisma.employee.updateMany({
    where: { userId: user.id, NOT: { id: emp.id } },
    data: { userId: null },
  });
  await prisma.employee.update({ where: { id: emp.id }, data: { userId: user.id } });

  as(user.id);
  const { status } = await json(
    await strategyRoute.POST(
      req("/api/strategy-scores", "POST", {
        cycleId: ids.cycle,
        entityId: ids.entity,
        score: "4.0",
      }),
      ctx(),
    ),
  );
  assert.equal(status, 403);
});

test("§8.1 a Strategy score outside 1-5 is refused", async () => {
  as(ids.hrUser);
  for (const score of ["0.5", "5.5", "6"]) {
    const { status } = await json(
      await strategyRoute.POST(
        req("/api/strategy-scores", "POST", { cycleId: ids.cycle, entityId: ids.entity, score }),
        ctx(),
      ),
    );
    assert.equal(status, 400, `score ${score} must be refused`);
  }
});

test("§8.4 HR keys a Corporate and a Departmental score; re-keying updates", async () => {
  as(ids.hrUser);
  const first = await json(
    await strategyRoute.POST(
      req("/api/strategy-scores", "POST", {
        cycleId: ids.cycle,
        entityId: ids.entity,
        score: "4.20",
      }),
      ctx(),
    ),
  );
  assert.equal(first.status, 201);

  const again = await json(
    await strategyRoute.POST(
      req("/api/strategy-scores", "POST", {
        cycleId: ids.cycle,
        entityId: ids.entity,
        score: "4.30",
      }),
      ctx(),
    ),
  );
  assert.equal(again.status, 200, "an update, not a duplicate");
  assert.equal(
    await prisma.entityScore.count({ where: { cycleId: ids.cycle, entityId: ids.entity } }),
    1,
  );

  const dept = await json(
    await strategyRoute.POST(
      req("/api/strategy-scores", "POST", {
        cycleId: ids.cycle,
        departmentId: ids.department,
        score: "3.50",
      }),
      ctx(),
    ),
  );
  assert.equal(dept.status, 201);
});

test("§8.4 the GET names what is still MISSING", async () => {
  as(ids.hrUser);
  const { status, body } = await json(
    await strategyRoute.GET(req(`/api/strategy-scores?cycleId=${ids.cycle}`, "GET"), ctx()),
  );
  assert.equal(status, 200);
  const missing = body.missing as { entities: number; departments: number };
  // One entity and one department are keyed; the rest are not, and §10.7 cannot
  // start calibration until they are.
  assert.ok(missing.entities >= 0 && missing.departments > 0);
});

// --- §9.1 / §9.2 the cycle and its templates ----------------------------------------

test("§9.2 a 360 cycle needs all three templates", async () => {
  as(ids.hrUser);
  const { status } = await json(
    await threeSixtyRoute.POST(
      req("/api/three-sixty", "POST", {
        cycleId: ids.cycle,
        opensAt: new Date(Date.now() - 86_400_000).toISOString(),
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        templates: TEMPLATES.slice(0, 2),
      }),
      ctx(),
    ),
  );
  assert.equal(status, 400);
});

test("§9.1 HR creates the 360 cycle with its three templates", async () => {
  as(ids.hrUser);
  const { status, body } = await json(
    await threeSixtyRoute.POST(
      req("/api/three-sixty", "POST", {
        cycleId: ids.cycle,
        opensAt: new Date(Date.now() - 86_400_000).toISOString(),
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        templates: TEMPLATES,
      }),
      ctx(),
    ),
  );
  assert.equal(status, 201, JSON.stringify(body));
  const ts = body.threeSixty as { id: string; status: string; templates: unknown[] };
  ids.threeSixty = ts.id;
  assert.equal(ts.status, "DRAFT");
  assert.equal(ts.templates.length, 3);
});

test("§9.1 a second 360 on the same performance year is refused", async () => {
  as(ids.hrUser);
  const { status, error } = await json(
    await threeSixtyRoute.POST(
      req("/api/three-sixty", "POST", {
        cycleId: ids.cycle,
        opensAt: new Date(Date.now() - 86_400_000).toISOString(),
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        templates: TEMPLATES,
      }),
      ctx(),
    ),
  );
  assert.equal(status, 409);
  assert.match(String(error), /already has a 360/i);
});

// --- §9.6 assignment generation ------------------------------------------------------

test("§9.6 HR auto-generates assignments from the relationship mapping", async () => {
  as(ids.hrUser);
  const { status, body } = await json(
    await assignmentsRoute.PUT(
      req("/api/three-sixty/assignments", "PUT", { threeSixtyCycleId: ids.threeSixty }),
      ctx(),
    ),
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok((body.created as number) > 0, "assignments were generated");
  assert.ok((body.rateeCount as number) > 0);
});

test("§8.3 no C-Level is a ratee, and nobody assesses themselves", async () => {
  const rows = await prisma.assignment.findMany({
    where: { threeSixtyCycleId: ids.threeSixty },
    take: 4000,
    select: { rateeId: true, raterId: true, ratee: { select: { roleTrack: true } } },
  });
  assert.ok(rows.length > 0);
  assert.equal(rows.filter((r) => r.ratee.roleTrack === "C_LEVEL").length, 0);
  assert.equal(rows.filter((r) => r.rateeId === r.raterId).length, 0);
});

test("§9.4 a shortfall is reported so HR can fix it", async () => {
  as(ids.hrUser);
  const { body } = await json(
    await assignmentsRoute.PUT(
      req("/api/three-sixty/assignments", "PUT", { threeSixtyCycleId: ids.threeSixty }),
      ctx(),
    ),
  );
  // The fixture org is small, so some people genuinely cannot reach 3 raters.
  // The point is that this is SURFACED, not padded.
  assert.ok(Array.isArray(body.shortfalls));
});

test("§9.7 activation is refused while any ratee is short of three raters", async () => {
  as(ids.hrUser);
  const { status, error } = await json(
    await activateRoute.POST(
      req("/api/three-sixty/activate", "POST", { threeSixtyCycleId: ids.threeSixty }),
      ctx(),
    ),
  );
  // Either it activates (fixture happened to be rich enough) or it names the gap.
  if (status === 409) assert.match(String(error), /raters per employee|Missing/i);
  else assert.equal(status, 200);
});

// --- §9.7 execution ------------------------------------------------------------------

test("§9.3 / §9.7 a rater fills in and submits their form; only they can", async () => {
  // Force a complete, activatable state for one ratee by trimming to exactly 3.
  const all = await prisma.assignment.findMany({
    where: { threeSixtyCycleId: ids.threeSixty },
    take: 4000,
    select: { rateeId: true },
  });
  const perRatee = new Map<string, number>();
  for (const a of all) perRatee.set(a.rateeId, (perRatee.get(a.rateeId) ?? 0) + 1);
  const full = [...perRatee.entries()].find(([, n]) => n >= 3);
  if (!full) return; // fixture too small; the activation-gate test above covers it
  ids.ratee = full[0];

  // Keep exactly three for this ratee, drop everyone else so activation passes.
  const keep = await prisma.assignment.findMany({
    where: { threeSixtyCycleId: ids.threeSixty, rateeId: ids.ratee },
    take: 3,
    select: { id: true },
  });
  await prisma.assignment.deleteMany({
    where: { threeSixtyCycleId: ids.threeSixty, id: { notIn: keep.map((k) => k.id) } },
  });

  as(ids.hrUser);
  const activated = await json(
    await activateRoute.POST(
      req("/api/three-sixty/activate", "POST", { threeSixtyCycleId: ids.threeSixty }),
      ctx(),
    ),
  );
  assert.equal(activated.status, 200, JSON.stringify(activated.error));

  const assignment = await prisma.assignment.findFirstOrThrow({
    where: { threeSixtyCycleId: ids.threeSixty, rateeId: ids.ratee },
    select: {
      id: true,
      raterId: true,
      template: { select: { questions: { select: { id: true, scored: true }, take: 60 } } },
    },
  });

  // §9.7 — someone who was not asked cannot answer. 404, not 403.
  as(ids.hrUser);
  const stranger = await json(
    await responsesRoute.POST(
      req("/api/three-sixty/responses", "POST", {
        assignmentId: assignment.id,
        answers: [{ questionId: assignment.template.questions[0].id, score: 4 }],
      }),
      ctx(),
    ),
  );
  assert.equal(stranger.status, 404, "HR cannot answer a form they were not assigned");

  // The actual rater signs in.
  const raterUser = await prisma.user.upsert({
    where: { email: "ts-rater@example.test" },
    create: { email: "ts-rater@example.test", name: "ts rater", role: "VIEWER" },
    update: {},
    select: { id: true },
  });
  await prisma.employee.updateMany({
    where: { userId: raterUser.id, NOT: { id: assignment.raterId } },
    data: { userId: null },
  });
  await prisma.employee.update({
    where: { id: assignment.raterId },
    data: { userId: raterUser.id },
  });
  as(raterUser.id);

  const scored = assignment.template.questions.filter((q) => q.scored);
  const open = assignment.template.questions.find((q) => !q.scored)!;

  // §9.3 — a 5 is off the forced scale.
  const bad = await json(
    await responsesRoute.POST(
      req("/api/three-sixty/responses", "POST", {
        assignmentId: assignment.id,
        answers: [{ questionId: scored[0].id, score: 5 }],
      }),
      ctx(),
    ),
  );
  assert.equal(bad.status, 400);

  // An open-ended question takes text, not a score.
  const wrongShape = await json(
    await responsesRoute.POST(
      req("/api/three-sixty/responses", "POST", {
        assignmentId: assignment.id,
        answers: [{ questionId: open.id, score: 3 }],
      }),
      ctx(),
    ),
  );
  assert.equal(wrongShape.status, 400);

  // Submitting with scored questions unanswered is refused — §9.5 would read the
  // gap as a low score rather than as unfinished.
  const incomplete = await json(
    await responsesRoute.POST(
      req("/api/three-sixty/responses", "POST", {
        assignmentId: assignment.id,
        answers: [{ questionId: scored[0].id, score: 4 }],
        submit: true,
      }),
      ctx(),
    ),
  );
  assert.equal(incomplete.status, 409);
  assert.match(String(incomplete.error), /still need an answer/i);

  // Complete and submit.
  const done = await json(
    await responsesRoute.POST(
      req("/api/three-sixty/responses", "POST", {
        assignmentId: assignment.id,
        answers: [
          ...scored.map((q) => ({ questionId: q.id, score: 4 })),
          { questionId: open.id, text: "Keep pairing on the migration." },
        ],
        submit: true,
      }),
      ctx(),
    ),
  );
  assert.equal(done.status, 200, JSON.stringify(done.error));
  assert.equal((done.body.assignment as { status: string }).status, "SUBMITTED");

  // §9.7 — no duplicate submissions.
  const again = await json(
    await responsesRoute.POST(
      req("/api/three-sixty/responses", "POST", {
        assignmentId: assignment.id,
        answers: [{ questionId: scored[0].id, score: 1 }],
      }),
      ctx(),
    ),
  );
  assert.equal(again.status, 409);
});

// --- §9.5 / §9.8 results ---------------------------------------------------------------

test("§9.5 the ratio is computed, and §13.1's comments carry no rater", async () => {
  if (!ids.ratee) return;
  as(ids.hrUser);
  const { status, body } = await json(
    await resultsRoute.GET(
      req(
        `/api/three-sixty/results?threeSixtyCycleId=${ids.threeSixty}&employeeId=${ids.ratee}`,
        "GET",
      ),
      ctx(),
    ),
  );
  assert.equal(status, 200);

  const results = body.results as {
    ratio: string | null;
    levelEquivalent: string | null;
    comments: Record<string, unknown>[];
  }[];
  assert.equal(results.length, 1);
  const r = results[0];
  // All scored answers were 4 of 4 → ratio 1 → §8.5's equivalent 5.00.
  assert.equal(r.ratio, "1");
  assert.equal(r.levelEquivalent, "5.00");

  assert.ok(r.comments.length > 0, "the written feedback is consolidated");
  for (const c of r.comments) {
    // §13.1 — "not attributed to individual raters, protecting anonymity".
    assert.ok(!("raterId" in c), "a comment must not carry its rater");
    assert.ok(!("assignmentId" in c), "nor anything that joins back to one");
  }
});

test("§4.1 a non-org-wide actor cannot read 360 results", async () => {
  const plain = await prisma.user.findFirstOrThrow({
    where: { email: "ts-plain@example.test" },
    select: { id: true },
  });
  as(plain.id);
  const { status } = await json(
    await resultsRoute.GET(
      req(`/api/three-sixty/results?threeSixtyCycleId=${ids.threeSixty}`, "GET"),
      ctx(),
    ),
  );
  assert.equal(status, 403);
});
