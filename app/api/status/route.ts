import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { stageState } from "@/lib/pms/cycle";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { awaitingManager, stageProgress } from "@/lib/pms/status";
import { participantStatuses } from "@/lib/pms/status-query";

/**
 * §13.3 + §13.4 — the manager workspace, served by the shared status engine.
 *
 * §13.4: "The dashboard is a role-scoped view of ONE shared status engine:
 * manager sees their chain, HR sees org-wide. Not separate builds — one engine,
 * filtered by role." This route IS that filter, and `lib/pms/status.ts` is that
 * engine. The executive dashboard (§13.6) and HR's cycle-progress report
 * (§13.5) read the same two functions, so the three views cannot drift.
 *
 * ## Two scopes, because §13.3 asks for two
 *
 *   - `direct` — "My Team status dashboard (aggregate, live): across DIRECT
 *     reports". This is the manager's cockpit and the only actionable list;
 *     Appendix A's "one owner per assessment" is why nothing outside it is
 *     offered as a task.
 *   - `chain` — "Down-chain oversight (VIEW-ONLY): rolled-up completion health
 *     across the deeper reporting tree." Aggregates only, and the row list comes
 *     back without the action affordances the direct scope carries.
 *
 * HR and the executive viewers get org-wide for both, which is the same engine
 * with a null filter rather than a second implementation.
 *
 * §13.3 — "Shows status, scores, and bands — never salary or bonus." Nothing
 * here selects a compensation column; see `participantStatuses`.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const url = new URL(request.url);
    const cycleId = url.searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");
    const requestedScope = url.searchParams.get("scope") === "chain" ? "chain" : "direct";

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        year: true,
        status: true,
        stages: { select: { kind: true, opensAt: true, deadline: true, graceDays: true } },
      },
    });
    if (!cycle) return notFound("Cycle");

    // §5.4's lock, resolved on the SERVER. The status engine needs to know
    // whether the goal-setting window has closed to decide whether an unsigned
    // set is "outstanding" or merely "in progress", and a client clock must
    // never be able to answer that.
    const now = new Date();
    const goalStage = cycle.stages.find((s) => s.kind === "GOAL_SETTING") ?? null;
    const goalStageLocked = goalStage ? stageState(goalStage, now) === "LOCKED" : false;

    // The role filter — the whole of §13.4's "filtered by role".
    let scope: Set<string> | null;
    if (actor.capabilities.orgWide) {
      scope = null;
    } else if (!actor.employeeId) {
      return err("This account has no linked employee record (ADR-065).", 403);
    } else if (requestedScope === "chain") {
      scope = await descendantEmployeeIds(actor.employeeId);
    } else {
      const reports = await prisma.employee.findMany({
        where: { managerId: actor.employeeId, deletedAt: null },
        take: 200,
        select: { id: true },
      });
      scope = new Set(reports.map((r) => r.id));
    }

    const { rows, truncated } = await participantStatuses({
      cycleId,
      scope,
      goalStageLocked,
      // §13.2 — results are hidden until published. HR sees them before that
      // because HR is who publishes; a manager sees bands only once the cycle is
      // out, so nothing "partial/shifting" reaches the people being managed.
      includeScores: actor.capabilities.orgWide || (await isPublished(cycleId)),
    });

    return ok({
      cycle: { id: cycle.id, year: cycle.year, status: cycle.status },
      scope: actor.capabilities.orgWide ? "org" : requestedScope,
      // §13.3 — "view-only" down-chain. Stated in the payload so the screen does
      // not have to re-derive it from the role, which is what §13.4 warns against.
      readOnly: requestedScope === "chain" && !actor.capabilities.orgWide,
      goalStageLocked,
      // The read is capped. Said, never implied: a completion percentage over a
      // truncated roster read as the whole team's is worse than no percentage.
      truncated,
      progress: stageProgress(rows),
      outstanding: awaitingManager(rows).map((r) => r.participantId),
      rows: rows.map(serialize),
    });
  }),
  { id: "pms-status", limit: 120, windowMs: 60_000 },
);

async function isPublished(cycleId: string): Promise<boolean> {
  const publication = await prisma.cyclePublication.findUnique({
    where: { cycleId },
    select: { published: true },
  });
  return publication?.published ?? false;
}

function serialize(row: Awaited<ReturnType<typeof participantStatuses>>["rows"][number]) {
  return {
    participantId: row.participantId,
    employeeId: row.employeeId,
    name: row.name,
    employeeNumber: row.employeeNumber,
    managerName: row.managerName,
    department: row.department,
    entity: row.entity,
    goalSettingExempt: row.goalSettingExempt,
    kpiCount: row.kpiCount,
    weightageTotal: row.weightageTotal.toFixed(2),
    weightageComplete: row.weightageComplete,
    goalSettingState: row.goalSettingState,
    yearEndState: row.yearEndState,
    outstandingLabel: row.outstandingLabel,
    selfRatedCount: row.selfRatedCount,
    managerRatedCount: row.managerRatedCount,
    band: row.band,
    score: row.score?.toFixed(2) ?? null,
  };
}
