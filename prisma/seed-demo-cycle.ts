import type { PrismaClient } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import type { AssessmentType, RoleTrack } from "../generated/prisma/client";
import { enrolParticipants, isGoalSettingExempt } from "../lib/pms/cycle";
import { isThreeSixtyExempt } from "../lib/pms/three-sixty";
import { planAssignments } from "../lib/pms/three-sixty-assign";

/**
 * A complete performance year, for the demo fixture only.
 *
 * `seed-pms.ts` seeds the ORG — entities, departments, 36 people and the
 * reporting edges between them. It stops there, so every Phase 4-6 screen
 * (§8 scoring, §9 the 360, §10 calibration, §13 reports) renders its
 * empty state: "No performance cycles yet". That is honest, and it is also
 * the entire product for anyone reviewing the deployed URL, because a cycle
 * can only be built by walking December's goal-setting, June's mid-year and
 * November's year-end in sequence, through the UI, as a dozen different people.
 *
 * This builds that year's INPUTS in one pass: KPIs, sign-offs, year-end
 * ratings, §8.4's Strategy scores, a closed §9 360, §10.2's target
 * distribution, and §12's two edge cases. It deliberately stops short of
 * running the score calculation — §10.7 sequences that AFTER the inputs, and
 * it is HR's act, done from the calibration screen. Seeding the result too
 * would hide the one step this fixture exists to let someone exercise.
 *
 * ## It refuses to touch a real deployment
 *
 * Mirrors `bootstrapAdminEmployee`'s third guard, for the same reason and more
 * sharply: this writes appraisal RATINGS, and a rating invented by a build step
 * against a real person is worse than no data at all. Two conditions, both
 * required:
 *
 *  1. No import batch has ever run. §3 says real org data arrives by Excel
 *     import, so one batch means this database holds real people.
 *  2. Headcount is still fixture-sized.
 *
 * Neither is a permission check — it is not reachable from the app at all. They
 * exist so that running the wrong npm script against a production DATABASE_URL
 * is inert rather than catastrophic.
 */

/** The demo year. Distinct from the far-future years the test suites own. */
const DEMO_YEAR = 2026;

/** Above this, the population is not the demo fixture any more. */
const MAX_FIXTURE_HEADCOUNT = 60;

const d = (value: string) => new Prisma.Decimal(value);
const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/**
 * §8.4's Corporate score per entity, and a departmental spread that lands
 * people in more than one band — a fixture where everyone scores 3.00 shows
 * §10's calibration screen with nothing to calibrate.
 */
const ENTITY_SCORES: Record<string, string> = { RIHAL: "3.80", TP: "3.20", CL: "4.10" };
const DEPARTMENT_SCORE_SPREAD = ["4.40", "3.90", "3.50", "3.10", "2.80", "4.10", "3.30"];

/**
 * Deterministic, not random: a fixture that reshuffles on every re-seed makes
 * "the screenshot changed" ambiguous between a code change and the data moving.
 */
function spread(key: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100_000;
  return hash % size;
}

const KPI_SHAPE = [
  { weightage: "40.00", description: "Delivery — ship the committed roadmap for the year" },
  { weightage: "35.00", description: "Quality — defect escape rate and review turnaround" },
  { weightage: "25.00", description: "Collaboration — unblock other teams and share context" },
] as const;

const DESCRIPTORS = {
  descriptorOutstanding: "Consistently exceeded, and raised the bar for others",
  descriptorExcellent: "Exceeded the agreed target",
  descriptorTarget: "Met the agreed target",
  descriptorAlmostAchieved: "Fell just short of the agreed target",
  descriptorUnsatisfactory: "Did not meet the agreed target",
};

/** §9.2 — each type gets its own template; four scored questions plus feedback. */
const QUESTIONS: Record<AssessmentType, string[]> = {
  LINE_MANAGER_TO_EMPLOYEE: [
    "Delivers what they commit to, on the agreed timeline",
    "Raises risks early rather than at the deadline",
    "Works well with people outside their own team",
    "Takes ownership of quality in their own work",
  ],
  EMPLOYEE_TO_LINE_MANAGER: [
    "Gives me the context I need to do my work",
    "Is available when I am blocked",
    "Gives feedback I can act on",
    "Represents my work fairly to others",
  ],
  PEER_TO_PEER: [
    "Is dependable when we work together",
    "Communicates clearly and early",
    "Shares knowledge rather than holding it",
    "Handles disagreement constructively",
  ],
};
const FEEDBACK_QUESTION = "Anything else you would like to say about working with them?";

/**
 * §9.2's open-ended answers. A pool rather than one sentence: §13.1 shows these
 * consolidated and unattributed on the employee's scorecard, and three identical
 * lines there read as a rendering bug rather than as three people agreeing.
 */
const FEEDBACK_TEXTS = [
  "Straightforward to work with, and quick to answer when I needed something.",
  "Reliable on the detail. I would like to see them speak up earlier when a date is at risk.",
  "Strong year. Took on the awkward parts of the project without being asked.",
  "Good collaborator across teams; sometimes takes on more than one person can carry.",
  "Communicates clearly in writing, which made the handover much easier than it could have been.",
];

/**
 * findUnique-then-create — the shape `prisma/seed-pms.ts` already uses, and for
 * the same reason.
 *
 * `upsert` and `createMany` are both refused by `no-unaudited-bulk-write`
 * (ADR-010 / SECURITY.md §5): they bypass the audit extension. A seed that
 * writes appraisal ratings and sign-offs with no audit row is precisely what
 * that rule exists to stop, so this is the convention rather than a workaround
 * for it. Re-running stays a no-op instead of a duplicate-key crash.
 */
async function createIfAbsent(
  find: () => Promise<{ id: string } | null>,
  create: () => Promise<{ id: string }>,
): Promise<string> {
  const existing = await find();
  return existing ? existing.id : (await create()).id;
}

type Person = {
  id: string;
  odooId: string;
  managerId: string | null;
  roleTrack: RoleTrack;
  departmentId: string | null;
  entityId: string;
  status: string;
};

export async function seedDemoCycle(prisma: PrismaClient): Promise<void> {
  const say = (line: string) => console.log(`PMS demo cycle: ${line}`);

  // --- The two guards -------------------------------------------------------
  const importBatches = await prisma.importBatch.count();
  if (importBatches > 0) {
    say(
      `skipped — ${importBatches} employee import batch(es) have run, so this database ` +
        `holds real org data. This script invents appraisal ratings and must never write them ` +
        `against real people.`,
    );
    return;
  }
  const headcount = await prisma.employee.count();
  if (headcount === 0 || headcount > MAX_FIXTURE_HEADCOUNT) {
    say(`skipped — headcount is ${headcount}, which is not the demo fixture.`);
    return;
  }

  const hr = await prisma.employee.findFirst({
    where: { pmsRoles: { has: "HR_SUPER_ADMIN" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!hr) {
    say("skipped — no HR Super Admin exists to attribute the cycle to.");
    return;
  }

  // --- §2 the cycle and its three stages, all now behind us -----------------
  //
  // Year-end closed on the 20th: the fixture's purpose is the state §10.7 calls
  // "assessments completed & signed", which is where calibration begins.
  const cycle =
    (await prisma.performanceCycle.findUnique({
      where: { year: DEMO_YEAR },
      select: { id: true },
    })) ??
    (await prisma.performanceCycle.create({
      data: {
        year: DEMO_YEAR,
        status: "OPEN",
        openedById: hr.id,
        openedAt: utc(DEMO_YEAR - 1, 12, 1),
      },
      select: { id: true },
    }));

  const stages = [
    {
      kind: "GOAL_SETTING" as const,
      opensAt: utc(DEMO_YEAR - 1, 12, 1),
      deadline: utc(DEMO_YEAR, 1, 15),
    },
    { kind: "MID_YEAR" as const, opensAt: utc(DEMO_YEAR, 6, 1), deadline: utc(DEMO_YEAR, 7, 15) },
    { kind: "YEAR_END" as const, opensAt: utc(DEMO_YEAR, 8, 1), deadline: utc(DEMO_YEAR, 8, 20) },
  ];
  for (const stage of stages) {
    const existing = await prisma.cycleStage.findUnique({
      where: { cycleId_kind: { cycleId: cycle.id, kind: stage.kind } },
      select: { id: true },
    });
    if (existing) {
      await prisma.cycleStage.update({
        where: { id: existing.id },
        data: { opensAt: stage.opensAt, deadline: stage.deadline },
        select: { id: true },
      });
    } else {
      await prisma.cycleStage.create({
        data: { cycleId: cycle.id, ...stage },
        select: { id: true },
      });
    }
  }

  const { added } = await enrolParticipants(cycle.id);
  say(`cycle ${DEMO_YEAR} open, 3 stages, ${added} participant(s) enrolled.`);

  // --- §8.4 the Strategy team's figures, keyed by HR ------------------------
  const entities = await prisma.orgEntity.findMany({
    take: 20,
    select: { id: true, code: true },
  });
  for (const entity of entities) {
    const score = ENTITY_SCORES[entity.code] ?? "3.50";
    const existing = await prisma.entityScore.findUnique({
      where: { cycleId_entityId: { cycleId: cycle.id, entityId: entity.id } },
      select: { id: true },
    });
    if (existing) {
      await prisma.entityScore.update({
        where: { id: existing.id },
        data: { score: d(score) },
        select: { id: true },
      });
    } else {
      await prisma.entityScore.create({
        data: {
          cycleId: cycle.id,
          entityId: entity.id,
          score: d(score),
          enteredByEmployeeId: hr.id,
        },
        select: { id: true },
      });
    }
  }

  const departments = await prisma.department.findMany({
    take: 100,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  for (const [index, department] of departments.entries()) {
    const score = DEPARTMENT_SCORE_SPREAD[index % DEPARTMENT_SCORE_SPREAD.length];
    const existing = await prisma.departmentScore.findUnique({
      where: { cycleId_departmentId: { cycleId: cycle.id, departmentId: department.id } },
      select: { id: true },
    });
    if (existing) {
      await prisma.departmentScore.update({
        where: { id: existing.id },
        data: { score: d(score) },
        select: { id: true },
      });
    } else {
      await prisma.departmentScore.create({
        data: {
          cycleId: cycle.id,
          departmentId: department.id,
          score: d(score),
          enteredByEmployeeId: hr.id,
        },
        select: { id: true },
      });
    }
  }
  say(`§8.4 Strategy scores: ${entities.length} entity, ${departments.length} departmental.`);

  // --- §12 the two edge cases ----------------------------------------------
  //
  // BEFORE the KPI loop, not after: §12.3 splits the year into periods and each
  // period carries its own KPI set, so the periods have to exist before there is
  // anything to attach them to. Seeded the other way round, the transferred
  // employee ends up with one un-split set the split scoring path cannot read,
  // and is skipped for "Period 1 has no KPIs" — permanently, because §10.7
  // needs every participant scored and nothing would ever fill that gap.
  await seedEdgeCases(prisma, cycle.id, say);

  // --- §5.2 KPIs, §5.1 the lock, §5.1 both signatures, §7.1 the ratings -----
  const participants = await prisma.cycleParticipant.findMany({
    where: { cycleId: cycle.id },
    take: 200,
    select: {
      id: true,
      employeeId: true,
      employee: {
        select: {
          odooId: true,
          managerId: true,
          roleTrack: true,
          assignmentPeriods: {
            where: { cycleId: cycle.id },
            select: { id: true, managerEmployeeId: true },
            orderBy: { orderIndex: "asc" },
            take: 4,
          },
        },
      },
      kpis: { select: { id: true }, take: 10 },
    },
  });

  let ratedParticipants = 0;
  for (const participant of participants) {
    if (isGoalSettingExempt(participant.employee.roleTrack)) continue;
    if (participant.kpis.length > 0) continue; // already built by an earlier run

    // §5.3 — the set totals exactly 100. §12.3 — PER PERIOD when the year was
    // split, because each department's manager owns a complete set for their
    // own portion.
    const periods = participant.employee.assignmentPeriods;
    const buckets: (string | null)[] = periods.length >= 2 ? periods.map((p) => p.id) : [null];
    const kpis: string[] = [];
    for (const [bucketIndex, assignmentPeriodId] of buckets.entries()) {
      for (const [index, shape] of KPI_SHAPE.entries()) {
        const kpi = await prisma.kpi.create({
          data: {
            participantId: participant.id,
            assignmentPeriodId,
            description: shape.description,
            weightage: d(shape.weightage),
            orderIndex: bucketIndex * KPI_SHAPE.length + index,
            ...DESCRIPTORS,
          },
          select: { id: true },
        });
        kpis.push(kpi.id);
      }
    }

    // §5.1 — employee and manager sign, then HR's approval locks the baseline.
    //
    // HR stands in where there is no manager. That is not a shortcut: §3.4
    // allows a blank reporting line only for C-Level, who are exempt from all of
    // this anyway, so the only non-exempt participant here without one is the
    // bootstrap access record. Leaving its manager-side rating unwritten made it
    // unscoreable, which held §10.7's gate shut for the whole cycle over an
    // account that is not a person. §12.3 already names HR as the party who
    // consolidates when no single manager owns the assessment.
    const manager = participant.employee.managerId ?? hr.id;
    const goalSignOffs = [
      {
        participantId: participant.id,
        stageKind: "GOAL_SETTING" as const,
        party: "EMPLOYEE" as const,
        signedByEmployeeId: participant.employeeId,
        signedAt: utc(DEMO_YEAR, 1, 8),
      },
      ...(manager
        ? [
            {
              participantId: participant.id,
              stageKind: "GOAL_SETTING" as const,
              party: "MANAGER" as const,
              signedByEmployeeId: manager,
              signedAt: utc(DEMO_YEAR, 1, 10),
            },
          ]
        : []),
    ];
    for (const row of goalSignOffs) {
      await createIfAbsent(
        () =>
          prisma.signOff.findUnique({
            where: {
              participantId_stageKind_party: {
                participantId: row.participantId,
                stageKind: row.stageKind,
                party: row.party,
              },
            },
            select: { id: true },
          }),
        () => prisma.signOff.create({ data: row, select: { id: true } }),
      );
    }
    await prisma.cycleParticipant.update({
      where: { id: participant.id },
      data: { goalsApprovedAt: utc(DEMO_YEAR, 1, 12), goalsApprovedById: hr.id },
      select: { id: true },
    });

    // §7.1 — the self-assessment, then the manager's review of it. The manager
    // diverges on one KPI in three, and §7.2's mandatory reason travels with it.
    const base = 2 + spread(participant.employee.odooId, 4); // 2..5
    for (const [index, kpiId] of kpis.entries()) {
      const self = Math.min(5, Math.max(1, base + (index === 1 ? 1 : 0)));
      const diverges = spread(`${participant.employee.odooId}:${index}`, 3) === 0;
      const managerLevel = diverges ? Math.min(5, Math.max(1, self - 1)) : self;
      const ratingRows = [
        {
          kpiId,
          party: "EMPLOYEE" as const,
          level: self,
          ratedByEmployeeId: participant.employeeId,
          ratedAt: utc(DEMO_YEAR, 8, 8),
        },
        ...(manager
          ? [
              {
                kpiId,
                party: "MANAGER" as const,
                level: managerLevel,
                comment: diverges
                  ? "Solid year on this objective, but the agreed target was not fully met — " +
                    "discussed in the year-end conversation."
                  : null,
                ratedByEmployeeId: manager,
                ratedAt: utc(DEMO_YEAR, 8, 14),
              },
            ]
          : []),
      ];
      for (const row of ratingRows) {
        await createIfAbsent(
          () =>
            prisma.kpiRating.findUnique({
              where: { kpiId_party: { kpiId: row.kpiId, party: row.party } },
              select: { id: true },
            }),
          () => prisma.kpiRating.create({ data: row, select: { id: true } }),
        );
      }
    }

    // §7.1 — the year-end pair, on the same participant as goal-setting's.
    const yearEndSignOffs = [
      {
        participantId: participant.id,
        stageKind: "YEAR_END" as const,
        party: "EMPLOYEE" as const,
        signedByEmployeeId: participant.employeeId,
        signedAt: utc(DEMO_YEAR, 8, 16),
      },
      ...(manager
        ? [
            {
              participantId: participant.id,
              stageKind: "YEAR_END" as const,
              party: "MANAGER" as const,
              signedByEmployeeId: manager,
              signedAt: utc(DEMO_YEAR, 8, 18),
            },
          ]
        : []),
    ];
    for (const row of yearEndSignOffs) {
      await createIfAbsent(
        () =>
          prisma.signOff.findUnique({
            where: {
              participantId_stageKind_party: {
                participantId: row.participantId,
                stageKind: row.stageKind,
                party: row.party,
              },
            },
            select: { id: true },
          }),
        () => prisma.signOff.create({ data: row, select: { id: true } }),
      );
    }
    ratedParticipants++;
  }
  say(`§5/§7: ${ratedParticipants} participant(s) with a locked baseline and a signed year-end.`);

  // --- §9 the 360, run to CLOSED -------------------------------------------
  await seedThreeSixty(prisma, cycle.id, say);

  // --- §10.2 the target distribution ---------------------------------------
  await createIfAbsent(
    () =>
      prisma.calibrationTarget.findUnique({ where: { cycleId: cycle.id }, select: { id: true } }),
    () =>
      prisma.calibrationTarget.create({
        data: {
          cycleId: cycle.id,
          outstandingPct: d("10.00"),
          excellentPct: d("20.00"),
          targetPct: d("40.00"),
          almostAchievedPct: d("20.00"),
          unsatisfactoryPct: d("10.00"),
          minDepartmentSize: 5,
        },
        select: { id: true },
      }),
  );

  say(
    `inputs complete. §10.7 sequences the score calculation AFTER this — run it from the ` +
      `calibration screen as HR Super Admin.`,
  );
}

/**
 * §9.1-§9.8 — one 360 cycle, three templates, HR's rater mapping, and every
 * form submitted. Uses the same `planAssignments` the route uses, so the
 * fixture's mapping is the product's mapping rather than a second opinion.
 */
async function seedThreeSixty(
  prisma: PrismaClient,
  cycleId: string,
  say: (line: string) => void,
): Promise<void> {
  const existing = await prisma.threeSixtyCycle.findUnique({
    where: { cycleId },
    select: { id: true, assignments: { select: { id: true }, take: 1 } },
  });
  if (existing && existing.assignments.length > 0) {
    say("§9 360 already built; left as-is.");
    return;
  }

  const threeSixty =
    existing ??
    (await prisma.threeSixtyCycle.create({
      data: {
        cycleId,
        status: "ACTIVE",
        opensAt: utc(DEMO_YEAR, 8, 1),
        deadline: utc(DEMO_YEAR, 8, 20),
      },
      select: { id: true, assignments: { select: { id: true }, take: 1 } },
    }));

  // §9.2's three templates, each with four scored questions and one open-ended.
  const templateByType = new Map<string, string>();
  const questionsByTemplate = new Map<string, { scored: string[]; feedback: string }>();
  for (const type of Object.keys(QUESTIONS) as AssessmentType[]) {
    const templateId = await createIfAbsent(
      () =>
        prisma.assessmentTemplate.findUnique({
          where: { threeSixtyCycleId_type: { threeSixtyCycleId: threeSixty.id, type } },
          select: { id: true },
        }),
      () =>
        prisma.assessmentTemplate.create({
          data: { threeSixtyCycleId: threeSixty.id, type },
          select: { id: true },
        }),
    );
    templateByType.set(type, templateId);
    for (const [index, text] of QUESTIONS[type].entries()) {
      await createIfAbsent(
        () =>
          prisma.templateQuestion.findUnique({
            where: { templateId_orderIndex: { templateId, orderIndex: index } },
            select: { id: true },
          }),
        () =>
          prisma.templateQuestion.create({
            data: { templateId, text, orderIndex: index, scored: true },
            select: { id: true },
          }),
      );
    }
    // §9.5 sums the answered SCORES, so the open-ended one is `scored: false`
    // and sits last rather than being counted as a zero.
    await createIfAbsent(
      () =>
        prisma.templateQuestion.findUnique({
          where: { templateId_orderIndex: { templateId, orderIndex: 99 } },
          select: { id: true },
        }),
      () =>
        prisma.templateQuestion.create({
          data: { templateId, text: FEEDBACK_QUESTION, orderIndex: 99, scored: false },
          select: { id: true },
        }),
    );
    questionsByTemplate.set(templateId, {
      scored: QUESTIONS[type],
      feedback: FEEDBACK_QUESTION,
    });
  }

  const people: Person[] = await prisma.employee.findMany({
    where: { deletedAt: null },
    take: 500,
    select: {
      id: true,
      odooId: true,
      managerId: true,
      roleTrack: true,
      departmentId: true,
      entityId: true,
      status: true,
    },
  });
  const active = people.filter((p) => p.status === "ACTIVE");
  const byId = new Map(active.map((p) => [p.id, p]));
  const rateable = active.filter((p) => !isThreeSixtyExempt(p.roleTrack));

  const { planned, shortfalls } = planAssignments({
    rateable,
    people: active,
    byId,
    templateByType,
    projectPeersByEmployee: new Map(),
  });

  // §9.7 — publishing the cycle is what makes the assignments live; every form
  // is then answered, because a 360 with gaps leaves §8.5 unable to score.
  const questionRows = await prisma.templateQuestion.findMany({
    where: { templateId: { in: [...templateByType.values()] } },
    take: 200,
    select: { id: true, templateId: true, scored: true, orderIndex: true },
  });
  const byTemplate = new Map<string, typeof questionRows>();
  for (const question of questionRows) {
    byTemplate.set(question.templateId, [...(byTemplate.get(question.templateId) ?? []), question]);
  }

  let submitted = 0;
  for (const plan of planned) {
    const assignmentId = await createIfAbsent(
      () =>
        prisma.assignment.findUnique({
          where: {
            threeSixtyCycleId_rateeId_raterId: {
              threeSixtyCycleId: threeSixty.id,
              rateeId: plan.rateeId,
              raterId: plan.raterId,
            },
          },
          select: { id: true },
        }),
      () =>
        prisma.assignment.create({
          data: {
            threeSixtyCycleId: threeSixty.id,
            rateeId: plan.rateeId,
            raterId: plan.raterId,
            templateId: plan.templateId,
            status: "SUBMITTED",
            submittedAt: utc(DEMO_YEAR, 8, 18),
          },
          select: { id: true },
        }),
    );

    for (const question of byTemplate.get(plan.templateId) ?? []) {
      // §9.3's forced four-point scale — no neutral midpoint to hide behind.
      const score = question.scored
        ? 2 + (spread(`${plan.rateeId}:${plan.raterId}:${question.orderIndex}`, 3) % 3)
        : null;
      await createIfAbsent(
        () =>
          prisma.assignmentResponse.findUnique({
            where: { assignmentId_questionId: { assignmentId, questionId: question.id } },
            select: { id: true },
          }),
        () =>
          prisma.assignmentResponse.create({
            data: {
              assignmentId,
              questionId: question.id,
              score,
              text: question.scored
                ? null
                : FEEDBACK_TEXTS[spread(`${plan.rateeId}:${plan.raterId}`, FEEDBACK_TEXTS.length)],
            },
            select: { id: true },
          }),
      );
    }
    submitted++;
  }

  // §9.8 — results are calculated once the cycle closes.
  await prisma.threeSixtyCycle.update({
    where: { id: threeSixty.id },
    data: { status: "CLOSED" },
    select: { id: true },
  });

  say(
    `§9 360 closed: ${submitted} assignment(s) submitted across ${rateable.length} ratee(s)` +
      (shortfalls.length ? `, ${shortfalls.length} with fewer than 3 raters available` : ""),
  );
}

/**
 * §12.1's leaver and §12.3's mid-year transfer — one of each, because both
 * reshape a screen (`/admin/edge-cases`) that otherwise only ever shows its
 * empty state, and both change how the person is scored.
 */
async function seedEdgeCases(
  prisma: PrismaClient,
  cycleId: string,
  say: (line: string) => void,
): Promise<void> {
  // Each half guards itself. A single guard over both would leave a run that
  // failed between them permanently half-applied — which is exactly what
  // happened the first time this script ran: five roll-up rows, and the manager
  // they were rolled up FROM still marked ACTIVE.
  const leavers = await prisma.employee.count({ where: { status: "LEAVER" } });
  if (leavers > 0) {
    say("§12.1 leaver already present; left as-is.");
  } else {
    // §12.1 — a manager leaves mid-year, and their reports roll up one level.
    const departing = await prisma.employee.findFirst({
      where: {
        status: "ACTIVE",
        managerId: { not: null },
        OR: [
          { reports: { some: { status: "ACTIVE" } } },
          { rollUpsFrom: { some: { resolvedAt: null } } },
        ],
      },
      select: { id: true, name: true, managerId: true },
      orderBy: { odooId: "asc" },
    });
    if (departing?.managerId) {
      const reports = await prisma.employee.findMany({
        where: { managerId: departing.id, status: "ACTIVE" },
        take: 50,
        select: { id: true },
      });
      for (const report of reports) {
        // §12.1's partial unique index allows one OPEN roll-up per employee, so
        // re-running must not race it into a constraint violation.
        const open = await prisma.managerRollUp.count({
          where: { employeeId: report.id, resolvedAt: null },
        });
        if (open === 0) {
          await prisma.managerRollUp.create({
            data: {
              employeeId: report.id,
              fromManagerEmployeeId: departing.id,
              toManagerEmployeeId: departing.managerId,
              reason: "LEAVER_ROLLUP",
            },
            select: { id: true },
          });
        }
        await prisma.employee.update({
          where: { id: report.id },
          data: { managerId: departing.managerId },
          select: { id: true },
        });
      }
      await prisma.employee.update({
        where: { id: departing.id },
        data: { status: "LEAVER", lastWorkingDay: utc(DEMO_YEAR, 6, 30) },
        select: { id: true },
      });
      say(`§12.1 leaver: ${departing.name} left 30 Jun, ${reports.length} report(s) rolled up.`);
    }
  }

  const periods = await prisma.employeeAssignmentPeriod.count({ where: { cycleId } });
  if (periods > 0) {
    say("§12.3 transfer already present; left as-is.");
    return;
  }

  // §12.3 — a transfer splits the year, each period owned by its own manager.
  const mover = await prisma.employee.findFirst({
    where: { status: "ACTIVE", departmentId: { not: null }, roleTrack: "INDIVIDUAL" },
    select: { id: true, name: true, departmentId: true, entityId: true, managerId: true },
    orderBy: { odooId: "desc" },
  });
  const otherDepartment = mover
    ? await prisma.department.findFirst({
        where: { entityId: mover.entityId, id: { not: mover.departmentId ?? undefined } },
        select: { id: true },
        orderBy: { name: "asc" },
      })
    : null;
  // §12.3 — "each department's manager drafts and assesses their own portion".
  // The receiving period therefore needs the RECEIVING department's manager, not
  // the one they left: both periods naming the same person contradicts the whole
  // reason the year is split, and the screen puts the two side by side.
  const receivingManager = otherDepartment
    ? await prisma.employee.findFirst({
        where: {
          departmentId: otherDepartment.id,
          status: "ACTIVE",
          roleTrack: { in: ["MANAGER", "DIRECTOR", "LEAD"] },
        },
        select: { id: true },
        orderBy: { odooId: "asc" },
      })
    : null;
  if (mover && otherDepartment) {
    const periodRows = [
      {
        employeeId: mover.id,
        cycleId,
        departmentId: mover.departmentId,
        entityId: mover.entityId,
        managerEmployeeId: mover.managerId,
        startsOn: utc(DEMO_YEAR, 1, 1),
        endsOn: utc(DEMO_YEAR, 5, 31),
        orderIndex: 0,
      },
      {
        employeeId: mover.id,
        cycleId,
        departmentId: otherDepartment.id,
        entityId: mover.entityId,
        managerEmployeeId: receivingManager?.id ?? mover.managerId,
        startsOn: utc(DEMO_YEAR, 6, 1),
        endsOn: utc(DEMO_YEAR, 12, 31),
        orderIndex: 1,
      },
    ];
    for (const row of periodRows) {
      await createIfAbsent(
        () =>
          prisma.employeeAssignmentPeriod.findUnique({
            where: {
              employeeId_cycleId_orderIndex: {
                employeeId: row.employeeId,
                cycleId: row.cycleId,
                orderIndex: row.orderIndex,
              },
            },
            select: { id: true },
          }),
        () => prisma.employeeAssignmentPeriod.create({ data: row, select: { id: true } }),
      );
    }
    say(`§12.3 transfer: ${mover.name}'s year split at 1 Jun across two departments.`);
  }
}
