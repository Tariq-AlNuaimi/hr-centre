import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { YEAR_END_STAGE, divergenceBlockedReason, ratingBlockedReason } from "@/lib/pms/rating";
import { yearEndState } from "@/lib/pms/year-end";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";
import { upsertRatingSchema } from "@/lib/validations/rating";
import { CYCLE_POLICY_SELECT, policyFor } from "@/lib/pms/cycle-policy";

/**
 * §7.1 — the year-end assessment: the employee self-assesses against each KPI,
 * then the manager reviews.
 *
 * POST is an UPSERT, not a create. §7.1 describes one assessment each, and
 * re-rating before the deadline is a correction rather than a second opinion —
 * an append-only trail here would make "the employee's rating" ambiguous at the
 * moment of signing. The unique key `[kpiId, party]` is what makes that true.
 *
 * ## Two rules that are NOT in §7, decided by the operator
 *
 *  - the manager SEES the self-assessment while reviewing (§7.1's word is
 *    "reviews"), so the response carries it
 *  - a manager who rates DIFFERENTLY must say why — enforced here and pinned in
 *    `tests/contracts/pms-rating.test.ts`
 *
 * Both are marked as additions wherever they appear, so a later reader does not
 * mistake them for the specification.
 */

const KPI_CONTEXT = {
  id: true,
  participantId: true,
  participant: {
    select: {
      id: true,
      goalsApprovedAt: true,
      // Enumerated columns only — §4.5 keeps salary out of an assessment payload.
      employee: { select: { id: true, managerId: true, roleTrack: true } },
      cycle: {
        select: {
          status: true,
          stages: {
            where: { kind: YEAR_END_STAGE },
            select: { kind: true, opensAt: true, deadline: true, graceDays: true },
          },
          // §7.1's divergence rule for THIS cycle. The rule a manager is held to
          // must be the one their cycle was opened under — see
          // lib/pms/cycle-policy.ts for why this is per-cycle and frozen.
          ...CYCLE_POLICY_SELECT,
        },
      },
      kpis: { where: { deletedAt: null }, select: { id: true }, take: 200 },
    },
  },
} satisfies Prisma.KpiSelect;

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const now = new Date();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = upsertRatingSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { kpiId, party, level, comment } = parsed.data;

    const kpi = await prisma.kpi.findFirst({
      where: { id: kpiId, deletedAt: null },
      select: KPI_CONTEXT,
    });
    if (!kpi) return notFound("KPI");

    const { participant } = kpi;

    // §4.2 — visibility before authority, and 404 rather than 403, so a KPI id
    // cannot be probed for existence from outside the actor's chain.
    const descendants = await visibilityDescendants(actor);
    if (!canViewEmployee(actor, participant.employee.id, descendants)) return notFound("KPI");

    if (participant.cycle.status !== "OPEN") {
      return err(
        `Year-end assessment runs while the cycle is open — this cycle is ${participant.cycle.status}.`,
        409,
      );
    }

    // The employee's rating for THIS KPI: it decides both §7.1's order (the
    // manager cannot review an unassessed KPI) and the divergence rule.
    const employeeRating = await prisma.kpiRating.findUnique({
      where: { kpiId_party: { kpiId, party: "EMPLOYEE" } },
      select: { level: true },
    });

    const blocked = ratingBlockedReason({
      actor,
      party,
      subject: participant.employee,
      stage: participant.cycle.stages[0] ?? null,
      now,
      goalsApprovedAt: participant.goalsApprovedAt,
      employeeRated: employeeRating !== null,
    });
    if (blocked) {
      return blocked.status === 404 ? notFound("KPI") : err(blocked.reason, blocked.status);
    }

    // §7.1's divergence rule, as THIS cycle answers it. Checked AFTER authority,
    // so a stranger never learns from the error message what the employee rated
    // themselves.
    const divergence = divergenceBlockedReason({
      party,
      level,
      employeeLevel: employeeRating?.level ?? null,
      comment: comment ?? null,
      policy: policyFor(participant.cycle),
    });
    if (divergence) return err(divergence, 409);

    const raterId = actor.employeeId;
    if (!raterId) return err("This account has no linked employee record (ADR-065).", 403);

    const existing = await prisma.kpiRating.findUnique({
      where: { kpiId_party: { kpiId, party } },
      select: { id: true },
    });

    // Upsert written as find-then-create/update rather than `prisma.upsert`:
    // `upsert` trips `no-unaudited-bulk-write`, and the audit extension records
    // a per-row CREATE or UPDATE through these paths — which is what §14's
    // "audit everything that changes a score" asks for.
    const rating = existing
      ? await prisma.kpiRating.update({
          where: { id: existing.id },
          data: { level, comment: comment ?? null, ratedByEmployeeId: raterId, ratedAt: now },
          select: { id: true, kpiId: true, party: true, level: true, comment: true, ratedAt: true },
        })
      : await prisma.kpiRating.create({
          data: { kpiId, party, level, comment: comment ?? null, ratedByEmployeeId: raterId },
          select: { id: true, kpiId: true, party: true, level: true, comment: true, ratedAt: true },
        });

    // The set-level position, so the screen can tell whether signing is now
    // possible without a second request (§7.1 signs the FINAL ratings).
    const ratings = await prisma.kpiRating.findMany({
      where: { kpi: { participantId: participant.id, deletedAt: null } },
      select: { kpiId: true, party: true, level: true },
      take: 400,
    });

    const payload = { rating, state: yearEndState(participant.kpis, ratings) };
    return existing ? ok(payload) : created(payload);
  }),
  { id: "pms-rating-write", limit: 120, windowMs: 60_000 },
);
