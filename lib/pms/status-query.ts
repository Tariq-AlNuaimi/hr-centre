import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { rosterWeightageTotal } from "./kpi";
import { displayScore } from "./scoring";
import { deriveStatus, type ParticipantStatus, type ParticipantStatusInput } from "./status";

/**
 * The one read behind §13.3, §13.5's cycle-progress and §13.6.
 *
 * §13.4 asks for "one engine, filtered by role", so the ROLE filter is a set of
 * employee ids passed in — this function never looks at the actor. That keeps
 * the scoping decision in one place (the route, which already resolved the
 * actor) and makes it impossible for a view to widen its own scope by reading
 * a different column.
 *
 * `scope === null` means org-wide, which only HR and the executive viewers ever
 * get; the route decides that, not this file.
 *
 * NOTE what is not selected: no salary, no bonus, no raw score. §13.3 —
 * "Shows status, scores, and bands — never salary or bonus."
 */

/**
 * The read is bounded, and callers are told when the bound bit.
 *
 * A status screen that silently stopped at 500 people would report a completion
 * percentage over a subset and present it as the org's — the exact failure mode
 * "no silent caps" exists to prevent. `participantStatuses` returns the flag;
 * every caller passes it on.
 */
const PARTICIPANT_PAGE = 500;

export async function participantStatuses(params: {
  cycleId: string;
  /** Employee ids to include; null = org-wide. */
  scope: ReadonlySet<string> | null;
  goalStageLocked: boolean;
  /** Include the calibrated band/score. Withheld until §13.2's publish for employees. */
  includeScores: boolean;
}): Promise<{ rows: ParticipantStatus[]; truncated: boolean }> {
  const { cycleId, scope, goalStageLocked, includeScores } = params;
  if (scope !== null && scope.size === 0) return { rows: [], truncated: false };

  const rows = await prisma.cycleParticipant.findMany({
    where: {
      cycleId,
      ...(scope === null ? {} : { employeeId: { in: [...scope] } }),
      employee: { deletedAt: null },
    },
    take: PARTICIPANT_PAGE + 1,
    orderBy: { employee: { name: "asc" } },
    select: {
      id: true,
      employeeId: true,
      goalsApprovedAt: true,
      employee: {
        select: {
          id: true,
          name: true,
          odooId: true,
          managerId: true,
          roleTrack: true,
          manager: { select: { name: true } },
          department: { select: { name: true } },
          entity: { select: { name: true } },
        },
      },
      kpis: {
        where: { deletedAt: null },
        take: 200,
        // §12.3 — the period is selected because §5.3's "exactly 100" binds per
        // portion, not across the year (see `rosterWeightageTotal`).
        select: {
          weightage: true,
          assignmentPeriodId: true,
          ratings: { select: { party: true }, take: 2 },
        },
      },
      signOffs: {
        where: { stageKind: { in: ["GOAL_SETTING", "YEAR_END"] } },
        take: 4,
        select: { stageKind: true, party: true, signedAt: true },
      },
    },
  });

  const truncated = rows.length > PARTICIPANT_PAGE;
  const page = rows.slice(0, PARTICIPANT_PAGE);

  const scoreByEmployee = includeScores
    ? await latestScores(
        cycleId,
        page.map((r) => r.employeeId),
      )
    : new Map<string, { band: string; score: Prisma.Decimal }>();

  const statuses = page.map((row) => {
    const signed = (stage: "GOAL_SETTING" | "YEAR_END", party: "EMPLOYEE" | "MANAGER") =>
      row.signOffs.find((s) => s.stageKind === stage && s.party === party)?.signedAt ?? null;

    // §12.3 — per portion, never summed across a split year. A flat sum here
    // put "Weightages total 200.00%" on a correctly-drafted transfer.
    const weightageTotal = rosterWeightageTotal(row.kpis);
    let selfRatedCount = 0;
    let managerRatedCount = 0;
    for (const kpi of row.kpis) {
      for (const r of kpi.ratings) {
        if (r.party === "EMPLOYEE") selfRatedCount += 1;
        else managerRatedCount += 1;
      }
    }

    const scored = scoreByEmployee.get(row.employeeId);
    const input: ParticipantStatusInput = {
      participantId: row.id,
      employeeId: row.employeeId,
      name: row.employee.name,
      employeeNumber: row.employee.odooId,
      managerId: row.employee.managerId,
      managerName: row.employee.manager?.name ?? null,
      department: row.employee.department?.name ?? null,
      entity: row.employee.entity.name,
      goalSettingExempt: row.employee.roleTrack === "C_LEVEL",
      kpiCount: row.kpis.length,
      weightageTotal,
      goalsApprovedAt: row.goalsApprovedAt,
      goalSetting: {
        employeeSignedAt: signed("GOAL_SETTING", "EMPLOYEE"),
        managerSignedAt: signed("GOAL_SETTING", "MANAGER"),
      },
      yearEnd: {
        employeeSignedAt: signed("YEAR_END", "EMPLOYEE"),
        managerSignedAt: signed("YEAR_END", "MANAGER"),
      },
      selfRatedCount,
      managerRatedCount,
      band: scored?.band ?? null,
      score: scored?.score ?? null,
    };
    return deriveStatus(input, goalStageLocked);
  });

  return { rows: statuses, truncated };
}

/**
 * The OUTCOME from the most recent run: the calibrated band, and the score that
 * agrees with it.
 *
 * §10 moves bands rather than scores, so `displayScore` clamps the raw figure
 * into the band actually awarded — the same number the employee sees on their
 * own scorecard (§13.1), so a manager and their report are never looking at two
 * different versions of the same result. The raw score stays in its column for
 * §13.5's master export, which is HR Super Admin only.
 */
async function latestScores(
  cycleId: string,
  employeeIds: readonly string[],
): Promise<Map<string, { band: string; score: Prisma.Decimal }>> {
  const out = new Map<string, { band: string; score: Prisma.Decimal }>();
  if (employeeIds.length === 0) return out;

  const runs = await prisma.scoreRun.findMany({
    where: { cycleId },
    take: 1,
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (runs.length === 0) return out;

  const scores = await prisma.employeeScore.findMany({
    where: { scoreRunId: runs[0].id, employeeId: { in: [...employeeIds] } },
    take: PARTICIPANT_PAGE,
    select: { employeeId: true, calibratedBand: true, rawScore: true },
  });
  for (const s of scores) {
    out.set(s.employeeId, {
      band: s.calibratedBand,
      score: displayScore(s.rawScore, s.calibratedBand),
    });
  }
  return out;
}
