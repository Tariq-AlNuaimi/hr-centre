import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { MID_YEAR_STAGE, effectiveChangeRequestStatus } from "@/lib/pms/change-request";
import { CHANGE_REQUEST_SELECT, serializeChangeRequest } from "@/lib/pms/change-request-select";

/**
 * §6 from the EMPLOYEE's side — everything their mid-year screen needs, once.
 *
 * The manager's mid-year workspace answers "whose KPIs am I changing"; this
 * answers "what is being done to mine", which is a different question with a
 * different scope: exactly one participant, always the caller's own. There is
 * no `employeeId` parameter and deliberately so — a route that takes one has to
 * defend it, and this one has nothing to defend because the only subject it can
 * ever return is `actor.employeeId`.
 *
 * ONE round trip rather than three. The screen needs the locked KPIs, the
 * pending request and the history together or it cannot render the old → new
 * comparison at all, and three client calls would make the comparison depend on
 * three results arriving.
 *
 * §4.5 — `basicSalaryEnc` is never selected here, by enumerating columns rather
 * than including relations. Nothing on this screen is a salary or a bonus
 * question, so nothing in this payload is either.
 */

/** Phase-3 sets are a handful of KPIs; the cap guards a malformed count. */
const KPI_CAP = 200;
/** §6.3's history is per participant per year — small, and bounded anyway. */
const HISTORY_CAP = 50;

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.employeeId) {
      return err(
        "This account is not linked to an employee record yet, so it has no KPIs of its own " +
          "(ADR-065). HR links the two when the employee data is imported.",
        403,
      );
    }

    // §2 — one cycle per year and exactly one of them is the year being run.
    const cycle = await prisma.performanceCycle.findFirst({
      where: { status: "OPEN" },
      orderBy: { year: "desc" },
      select: {
        id: true,
        year: true,
        status: true,
        stages: {
          where: { kind: MID_YEAR_STAGE },
          select: { kind: true, opensAt: true, deadline: true, graceDays: true },
        },
      },
    });
    if (!cycle) return ok({ cycle: null, participant: null, kpis: [], changeRequests: [] });

    const participant = await prisma.cycleParticipant.findFirst({
      where: { cycleId: cycle.id, employeeId: actor.employeeId },
      select: {
        id: true,
        goalsApprovedAt: true,
        kpis: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          take: KPI_CAP,
          select: {
            id: true,
            description: true,
            weightage: true,
            descriptorOutstanding: true,
            descriptorExcellent: true,
            descriptorTarget: true,
            descriptorAlmostAchieved: true,
            descriptorUnsatisfactory: true,
            orderIndex: true,
          },
        },
        changeRequests: {
          orderBy: { requestedAt: "desc" },
          take: HISTORY_CAP,
          select: CHANGE_REQUEST_SELECT,
        },
      },
    });
    if (!participant) {
      return ok({
        cycle: { id: cycle.id, year: cycle.year },
        participant: null,
        kpis: [],
        changeRequests: [],
      });
    }

    const stage = cycle.stages[0] ?? null;
    const now = new Date();

    return ok({
      cycle: { id: cycle.id, year: cycle.year },
      stage,
      participant: { id: participant.id, goalsApprovedAt: participant.goalsApprovedAt },
      // The decimal crosses the wire as a STRING, the same rule `serializeKpi`
      // follows: JSON's only numeric type is a double and §5.3 compares against
      // exactly 100.
      kpis: participant.kpis.map((kpi) => ({ ...kpi, weightage: kpi.weightage.toString() })),
      changeRequests: participant.changeRequests.map((row) => ({
        ...serializeChangeRequest(row),
        // §6.2 — what the request IS now, not what its column last recorded. A
        // deadline that passed without an acknowledgment locks the request, and
        // the screen must say so even if the sweep has not run yet.
        effectiveStatus: effectiveChangeRequestStatus({
          status: row.status,
          acknowledgedAt: row.acknowledgedAt,
          stage,
          now,
        }),
      })),
    });
  }),
  { id: "pms-mid-year-me", limit: 60, windowMs: 60_000 },
);
