import type { PrismaClient } from "../generated/prisma/client";
import { revokeLoginOnOffboard } from "../lib/pms/offboarding";
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

/**
 * How many participants are deliberately left MID-FLOW, so §5 and §9 have
 * something to perform rather than only something to look at.
 *
 * The red-team report's sharpest point about this fixture is that it wrote the
 * 360, its responses and the calibration target straight into the database and
 * so papered over every unreachable endpoint. The mirror-image problem is what
 * this constant fixes: a fixture that completes every flow leaves a
 * demonstration with nothing to demonstrate. Every screen is populated and every
 * button is already spent.
 *
 * Two participants are reserved, and the two states are §5.1's two routes to a
 * lock:
 *
 *   1. **Both parties signed, HR has not approved** — HR clicks "Approve and
 *      lock" live, on the affordance F11 added. `hrApprovalDecision` reports
 *      basis `BOTH_SIGNED`.
 *   2. **Manager signed, employee did not, and the deadline has passed** — the
 *      §5.4 resolution, which the panel names as a materially different record
 *      before the click. `hrApprovalDecision` reports
 *      `HR_REVIEW_EMPLOYEE_UNSIGNED`.
 *
 * The employee's own SIGNATURE is deliberately not the thing left to perform:
 * the goal-setting deadline is January and the demo is in August, so §5.4 has
 * hard-locked the stage and the sign route refuses. Performing that would mean
 * moving the whole cycle's stage windows, which changes the state of every other
 * flow. HR's approval is the act §5 actually leaves open in August, and it is
 * the one that was unreachable until F11.
 *
 * ## THE COST, stated because it will surprise someone on stage
 *
 * §10.7 is explicit — "no calibration until all raw scores are in" — and a
 * participant with no HR-approved baseline cannot take a year-end sign-off
 * (§7.1), so cannot be scored. **While these two sit mid-flow, the calibration
 * screen is BLOCKED**, reporting `N-2 of N participants have a raw score`.
 *
 * That is §10.7 working, not a fixture bug, and it makes the demo run in the
 * spec's own order: approve the two baselines (§5.1) → rate and sign them
 * (§7.1) → re-run the scores (§8) → calibration opens (§10) → publish (§13).
 * Each step visibly unblocks the next, which is a better story than five
 * independent screens that were already full.
 *
 * Set to 0 for a fixture where every flow is already complete and §10 is open
 * from the first click.
 */
const RESERVED_MID_FLOW_PARTICIPANTS = 2;

/**
 * How long §9.1's 360 window stays open from the moment the fixture is seeded.
 *
 * Relative to the clock, not a fixed date: a hardcoded future deadline is a
 * hardcoded expiry, and this fixture is re-seeded for demos that happen after
 * whatever date we picked. 45 days is comfortably past a rehearsal-plus-demo
 * cycle without pretending a real 360 runs that long.
 */
const THREE_SIXTY_WINDOW_DAYS = 45;

/**
 * One 360 assignment per Nth RATEE is left NOT_STARTED, so §9.7 has forms left to
 * fill in.
 *
 * Per ratee, and never their last one. A first cut took every 7th entry of the
 * flat plan, which read as "spread across the population" and was not: the plan
 * is ordered by ratee, and 26 of 33 ratees have fewer than the three raters §9.4
 * intends — several have exactly one. Two of them had that one form taken away,
 * lost their whole panel, and became unscoreable ("no completed 360 assessment,
 * §9.5/§8.5"), which quietly widened the §10.7 blockage from the two reserved
 * participants to four. Measured, not reasoned about: the score run reported
 * 33 of 37 instead of the intended 35.
 */
const LEAVE_ONE_360_UNANSWERED_PER_NTH_RATEE = 3;

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
          pmsRoles: true,
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

  // Reserved for the live demo — see RESERVED_MID_FLOW_PARTICIPANTS. Chosen by
  // `odooId` rather than at random so a re-seed leaves the SAME two people
  // mid-flow: a fixture that reshuffles is one nobody can rehearse against.
  // C-Level are skipped because §8.3 exempts them from goal setting entirely,
  // so there is no baseline of theirs to leave unapproved.
  const reservedIds = new Set(
    participants
      .filter(
        (p) =>
          !isGoalSettingExempt(p.employee.roleTrack) &&
          // Not someone holding an HR role, and not the bootstrap access record.
          // The two lowest ids happen to be the HR Super Admin and the HRBP, and
          // "watch HR approve HR's own baseline" is a confusing thing to put on a
          // stage — §5.1 permits it, but the flow being shown is a line manager's
          // set reaching HR, not HR's own.
          p.employee.pmsRoles.length === 0 &&
          p.employee.odooId !== "BOOTSTRAP-ADMIN",
      )
      .sort((a, b) => a.employee.odooId.localeCompare(b.employee.odooId))
      .slice(0, RESERVED_MID_FLOW_PARTICIPANTS)
      .map((p) => p.id),
  );
  /** The second reserved participant also goes without the EMPLOYEE signature. */
  const employeeUnsignedId = [...reservedIds][1] ?? null;

  let ratedParticipants = 0;
  for (const participant of participants) {
    if (isGoalSettingExempt(participant.employee.roleTrack)) continue;
    if (participant.kpis.length > 0) continue; // already built by an earlier run
    const reserved = reservedIds.has(participant.id);

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
      // §5.4's case, on the one participant reserved for it: the employee let
      // the deadline pass. There is no "rejected" row to write — §5.3 is
      // explicit that "the unsigned state IS the signal" — so the demo state is
      // the ABSENCE of this row, not a flag beside it.
      ...(participant.id === employeeUnsignedId
        ? []
        : [
            {
              participantId: participant.id,
              stageKind: "GOAL_SETTING" as const,
              party: "EMPLOYEE" as const,
              signedByEmployeeId: participant.employeeId,
              signedAt: utc(DEMO_YEAR, 1, 8),
            },
          ]),
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
    if (reserved) {
      // Stop here. No HR approval, and therefore no §7 rating and no year-end
      // sign-off either — `POST /api/year-end-signoffs` refuses without an
      // HR-approved baseline, and seeding one anyway would recreate exactly the
      // "impossible state written behind the product's back" the red-team report
      // called out. The rest of this loop body is what the demo performs.
      continue;
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

  // §9.1's window, OPEN rather than historical. The fixture used to open on
  // 1 August and close on the 20th, both of which are in the past by the time
  // anyone demonstrates it — so §9.7's "answer your 360" had nothing left to
  // answer and §9 was a screen to look at rather than a flow to perform.
  //
  // Computed from the clock, not hardcoded: a fixed future date is a fixed
  // EXPIRY, and this fixture will be re-seeded for demos after that date. The
  // deadline is deliberately generous — a 360 whose window shuts mid-rehearsal
  // is worse than one that never opened.
  const now = new Date();
  const threeSixtyDeadline = new Date(now.getTime() + THREE_SIXTY_WINDOW_DAYS * 86_400_000);

  const threeSixty =
    existing ??
    (await prisma.threeSixtyCycle.create({
      data: {
        cycleId,
        status: "ACTIVE",
        opensAt: utc(DEMO_YEAR, 8, 1),
        deadline: threeSixtyDeadline,
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

  // Which assignments to leave unanswered, decided PER RATEE so nobody loses
  // their whole panel. A ratee with a single rater keeps it: taking their only
  // form makes them unscoreable (§8.5 gives every non-C-Level track a 360
  // weight), which would widen §10.7's blockage past the two participants
  // deliberately reserved for the demo.
  const plannedByRatee = new Map<string, typeof planned>();
  for (const plan of planned) {
    plannedByRatee.set(plan.rateeId, [...(plannedByRatee.get(plan.rateeId) ?? []), plan]);
  }
  const leaveUnanswered = new Set<string>();
  for (const [rateeIndex, [, rows]] of [...plannedByRatee.entries()].entries()) {
    if (rateeIndex % LEAVE_ONE_360_UNANSWERED_PER_NTH_RATEE !== 0) continue;
    if (rows.length < 2) continue; // never their last form
    leaveUnanswered.add(`${rows[0].rateeId}:${rows[0].raterId}`);
  }

  let submitted = 0;
  let left = 0;
  for (const plan of planned) {
    // §9.7's flow needs a form somebody can still fill in.
    //
    // These do NOT block §8: `threeSixtyLevels` averages the forms that came
    // back (§9.5, and F8's rater count now records how many that was), so a
    // ratee with two of three raters still scores. That is the same tolerance
    // the real cycle has, which is the point of a fixture.
    if (leaveUnanswered.has(`${plan.rateeId}:${plan.raterId}`)) {
      await createIfAbsent(
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
              status: "NOT_STARTED",
            },
            select: { id: true },
          }),
      );
      left++;
      continue;
    }

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

  // The cycle stays ACTIVE. It used to be CLOSED here, which is the right END
  // state and the wrong DEMO state: §9.7's answering form is refused on a closed
  // cycle, so the largest single piece of the specification had nothing anyone
  // could do to it. §9.8's consolidated report does not require CLOSED either —
  // it reads submitted assignments — so leaving it open costs §9.8 nothing and
  // gives §9.7 back.

  say(
    `§9 360 ACTIVE until ${threeSixtyDeadline.toISOString().slice(0, 10)}: ` +
      `${submitted} assignment(s) submitted across ${rateable.length} ratee(s), ` +
      `${left} left unanswered for §9.7 to perform` +
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
      // ADR-069's amendment: setting LEAVER revokes access. The fixture has to
      // obey the rule it exists to demonstrate — `provisionFixtureLogins` runs
      // before this and gives nearly everyone a login, so without this the demo
      // database would hold exactly the state the amendment eliminates: a
      // departed employee with a live account, on the screen built to show it.
      //
      // This is the FOURTH writer of `status = "LEAVER"`, after the three
      // production paths, and it reproduced the hole the same day the feature
      // landed — which is the honest argument that the invariant is held by
      // discipline at each call site rather than by anything structural.
      await revokeLoginOnOffboard(prisma as never, departing.id);
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
