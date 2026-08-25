import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { stageState } from "@/lib/pms/cycle";
import { completion, stageProgress, tallyBy, type ParticipantStatus } from "@/lib/pms/status";
import { participantStatuses } from "@/lib/pms/status-query";

/**
 * §13.5 — "Cycle-progress / completion tracking — org-wide status."
 *
 * The same engine §13.3 serves the manager from (§13.4: "one engine, filtered by
 * role"), read with the filter open. HR's version adds the per-department and
 * per-entity breakdown, because org-wide status that cannot be narrowed to a
 * department is a number nobody can act on.
 *
 * Org-wide visibility only — HR and the executive viewers. A manager gets the
 * same facts about their own chain from `/api/status`, which is the point of
 * sharing the engine.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgWide) {
      return err("Org-wide reporting is HR's and the executive viewers' (§13.5).", 403);
    }

    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        year: true,
        status: true,
        stages: {
          select: { kind: true, opensAt: true, deadline: true, graceDays: true },
        },
      },
    });
    if (!cycle) return notFound("Cycle");

    const now = new Date();
    const goalStage = cycle.stages.find((s) => s.kind === "GOAL_SETTING") ?? null;
    const goalStageLocked = goalStage ? stageState(goalStage, now) === "LOCKED" : false;

    const rows = await participantStatuses({
      cycleId,
      scope: null,
      goalStageLocked,
      includeScores: true,
    });

    return ok({
      cycle: {
        id: cycle.id,
        year: cycle.year,
        status: cycle.status,
        stages: cycle.stages.map((s) => ({
          kind: s.kind,
          opensAt: s.opensAt,
          deadline: s.deadline,
          state: stageState(s, now),
        })),
      },
      participantCount: rows.length,
      progress: stageProgress(rows),
      byDepartment: groupCompletion(rows, (r) => r.department),
      byEntity: groupCompletion(rows, (r) => r.entity),
      // Who is holding each stage up, named. §5.6 wants "manager name, what was
      // missed" — this is the live version of that, before the deadline turns it
      // into a compliance event.
      outstanding: rows
        .filter((r) => r.goalSettingState !== "COMPLETE" && r.goalSettingState !== "NOT_APPLICABLE")
        .slice(0, 200)
        .map((r) => ({
          employeeId: r.employeeId,
          name: r.name,
          managerName: r.managerName,
          department: r.department,
          state: r.goalSettingState,
          outstandingLabel: r.outstandingLabel,
        })),
    });
  }),
  { id: "pms-report-progress", limit: 60, windowMs: 60_000 },
);

/**
 * Completion per group, for both stages.
 *
 * Rows with no department (§1.2's C-Level exception) group under a null key
 * rather than being dropped: a total that silently excludes seven executives is
 * a total that does not reconcile with the participant count above it.
 */
function groupCompletion(
  rows: readonly ParticipantStatus[],
  pick: (row: ParticipantStatus) => string | null,
) {
  const groups = new Map<string | null, ParticipantStatus[]>();
  for (const row of rows) {
    const key = pick(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .map(([name, group]) => ({
      name,
      count: group.length,
      goalSetting: completion(tallyBy(group, (r) => r.goalSettingState)),
      yearEnd: completion(tallyBy(group, (r) => r.yearEndState)),
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}
