import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isGoalSettingExempt, stageState } from "@/lib/pms/cycle";
import { isStorageConfigured } from "@/lib/storage";
import { YEAR_END_STAGE, ratingBlockedReason } from "@/lib/pms/rating";
import { yearEndState } from "@/lib/pms/year-end";
import {
  YEAR_END_KPI_ORDER,
  YEAR_END_KPI_SELECT,
  serializeYearEndKpis,
} from "@/lib/pms/year-end-select";

/**
 * §7.1 from the EMPLOYEE's side — their own year-end self-assessment.
 *
 * The screen existed and worked; nothing routed anyone to it. `/year-end`
 * refused a plain employee with "your own assessment reaches you through My
 * Tasks", and My Tasks had no year-end card — so the only way in was to guess a
 * URL shaped `/year-end/<cycleId>/participants/<participantId>`. §7.1 opens
 * with the employee self-assessing, which made it the one step in the whole
 * flow that nobody could take.
 *
 * No `employeeId` parameter, by design — the rule `/api/mid-year/me` follows. A
 * route that takes one has to defend it; this one has nothing to defend,
 * because the only subject it can ever return is `actor.employeeId`.
 *
 * §4.5 — salary is never selected. The employee columns here are the three
 * `ratingBlockedReason` needs to reach its verdict, and nothing else.
 */

/** A year's KPI set is a handful; the cap guards a malformed count. */
const KPI_CAP = 200;

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.employeeId) {
      return err(
        "This account is not linked to an employee record yet, so it has no assessment of its " +
          "own (ADR-065). HR links the two when the employee data is imported.",
        403,
      );
    }

    // §2 — one cycle per year, and exactly one of them is the year being run.
    const cycle = await prisma.performanceCycle.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
      select: {
        id: true,
        year: true,
        stages: {
          where: { kind: YEAR_END_STAGE },
          select: { kind: true, opensAt: true, deadline: true, graceDays: true },
        },
      },
    });
    if (!cycle) {
      return ok({ cycle: null, participant: null, stage: null, kpis: [] });
    }

    const participant = await prisma.cycleParticipant.findFirst({
      where: { cycleId: cycle.id, employeeId: actor.employeeId },
      select: {
        id: true,
        goalsApprovedAt: true,
        employee: { select: { id: true, managerId: true, roleTrack: true } },
        kpis: {
          where: { deletedAt: null },
          orderBy: YEAR_END_KPI_ORDER,
          take: KPI_CAP,
          select: YEAR_END_KPI_SELECT,
        },
        signOffs: {
          where: { stageKind: YEAR_END_STAGE },
          select: { party: true },
        },
      },
    });

    const stage = cycle.stages[0] ?? null;
    const serializedStage =
      stage === null
        ? null
        : {
            opensAt: stage.opensAt.toISOString(),
            deadline: stage.deadline.toISOString(),
            graceDays: stage.graceDays,
            state: stageState(stage, new Date()),
          };

    if (!participant) {
      // §3.5 — "not enrolled" is a real answer, not an error. An employee
      // imported after the cycle opened becomes a participant through the
      // import or HR's "Enrol missing employees"; until then they have no set.
      return ok({
        cycle: { id: cycle.id, year: cycle.year },
        participant: null,
        stage: serializedStage,
        kpis: [],
      });
    }

    const now = new Date();
    const kpis = serializeYearEndKpis(participant.kpis);
    const state = yearEndState(
      participant.kpis,
      participant.kpis.flatMap((k) =>
        k.ratings.map((r) => ({ kpiId: k.id, party: r.party, level: r.level })),
      ),
    );

    // The SAME call the manager's participant page makes, so the screen and the
    // write route never disagree about why an action is unavailable. Every
    // precondition stays where it was — C-Level exemption (§8.3), self only,
    // an HR-approved baseline (§5.1), an open stage (§5.4). Being reachable is
    // not being permitted.
    const blocked = ratingBlockedReason({
      actor,
      party: "EMPLOYEE",
      subject: participant.employee,
      stage,
      now,
      goalsApprovedAt: participant.goalsApprovedAt,
      // Asked about the SET. §7.1's per-KPI ordering is enforced per row by the
      // write route, and the EMPLOYEE branch does not read this flag at all.
      employeeRated: state.employeeRated > 0,
    });

    return ok({
      cycle: { id: cycle.id, year: cycle.year },
      participant: { id: participant.id, goalsApprovedAt: participant.goalsApprovedAt },
      stage: serializedStage,
      kpis,
      state,
      signedParties: participant.signOffs.map((s) => s.party),
      goalSettingExempt: isGoalSettingExempt(participant.employee.roleTrack),
      blockedReason: blocked?.reason ?? null,
      // §7.1 — so the screen can say "files unavailable, links still work"
      // rather than offering a button that fails.
      storageConfigured: isStorageConfigured(),
    });
  }),
  { id: "pms-year-end-me", limit: 60, windowMs: 60_000 },
);
