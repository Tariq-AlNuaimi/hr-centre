import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { YEAR_END_STAGE } from "@/lib/pms/rating";
import {
  yearEndSignBlockedReason,
  yearEndSignerBlockedReason,
  yearEndState,
} from "@/lib/pms/year-end";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";
import { isGoalSettingExempt } from "@/lib/pms/cycle";
import { yearEndSignOffSchema } from "@/lib/validations/rating";

/**
 * §7.1's two signatures — "both sign off on the final ratings".
 *
 * A separate route from `/api/signoffs` rather than a `stageKind` parameter on
 * it, because the two stages sign DIFFERENT things and the preconditions have
 * nothing in common: §5.1 signs a KPI baseline and is gated on §5.3's
 * exactly-100 rule; §7.1 signs the final ratings and is gated on every KPI
 * carrying both a self-assessment and a manager review. Folding both into one
 * handler would mean a `stageKind` switch over two disjoint bodies of logic —
 * and a bug in either could reach the other, which is the one thing Phase 3a's
 * `stageKind` work exists to prevent.
 *
 * Everything the two DO share is already shared: the `SignOff` table, its
 * `[participantId, stageKind, party]` key, and the no-reject rule of §5.3 —
 * POST is the only verb here too. An unsigned year-end assessment is the
 * disagreement signal, and the correction path is the offline discussion §7.1
 * describes, not a DELETE.
 */

const PARTICIPANT_SELECT = {
  id: true,
  cycleId: true,
  goalsApprovedAt: true,
  // Enumerated columns — §4.5 keeps salary out of a sign-off payload.
  employee: { select: { id: true, managerId: true, roleTrack: true } },
  cycle: {
    select: {
      status: true,
      stages: {
        where: { kind: YEAR_END_STAGE },
        select: { kind: true, opensAt: true, deadline: true, graceDays: true },
      },
    },
  },
  kpis: { where: { deletedAt: null }, select: { id: true }, take: 200 },
  signOffs: {
    where: { stageKind: YEAR_END_STAGE },
    select: { party: true, signedAt: true },
  },
} satisfies Prisma.CycleParticipantSelect;

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const now = new Date();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = yearEndSignOffSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { participantId, party } = parsed.data;

    const participant = await prisma.cycleParticipant.findUnique({
      where: { id: participantId },
      select: PARTICIPANT_SELECT,
    });
    if (!participant) return notFound("Participant");

    // §4.2 — visibility first, 404 rather than 403.
    const descendants = await visibilityDescendants(actor);
    if (!canViewEmployee(actor, participant.employee.id, descendants))
      return notFound("Participant");

    // Authority BEFORE state: a stranger must not learn how complete someone
    // else's assessment is from the error message.
    const blockedSigner = yearEndSignerBlockedReason({
      actor,
      party,
      subject: participant.employee,
    });
    if (blockedSigner) {
      return blockedSigner.status === 404
        ? notFound("Participant")
        : err(blockedSigner.reason, blockedSigner.status);
    }

    // §8.3 — C-Level have no year-end assessment to sign; their score passes
    // through from the entity. Categorical, so it is answered before timing.
    if (isGoalSettingExempt(participant.employee.roleTrack)) {
      return err(
        "C-Level employees skip self-assessment entirely (§8.3) — there is no year-end " +
          "assessment to sign.",
        409,
      );
    }
    if (participant.cycle.status !== "OPEN") {
      return err(
        `Year-end sign-off runs while the cycle is open — this cycle is ${participant.cycle.status} (§2).`,
        409,
      );
    }
    if (participant.goalsApprovedAt === null) {
      return err(
        "This KPI set has no HR-approved baseline, so there are no agreed KPIs to assess (§5.1).",
        409,
      );
    }

    const signed = new Set(participant.signOffs.map((s) => s.party));
    const stage = participant.cycle.stages[0] ?? null;

    const ratings = await prisma.kpiRating.findMany({
      where: { kpi: { participantId, deletedAt: null } },
      select: { kpiId: true, party: true, level: true },
      take: 400,
    });
    const state = yearEndState(participant.kpis, ratings);

    // Idempotent, like §5.1's sign-off: a second POST is the same statement as
    // the first, so it reports the existing signature at 200 rather than 409.
    if (signed.has(party)) {
      return ok({ state, signedParties: [...signed], alreadySigned: true });
    }

    const blocked = yearEndSignBlockedReason({ state, stage, now });
    if (blocked) return err(blocked, 409);

    const signerId = actor.employeeId;
    if (!signerId) return err("This account has no linked employee record (ADR-065).", 403);

    try {
      await prisma.signOff.create({
        data: {
          participantId,
          stageKind: YEAR_END_STAGE,
          party,
          signedByEmployeeId: signerId,
          // Deliberately null: `kpiSetHash` records what a party agreed to at
          // GOAL-SETTING, where the thing signed is the KPI set. Here the thing
          // signed is the RATINGS, and every one of them is already a row of its
          // own with its own author and timestamp. Reusing the field would
          // record a digest of the wrong artifact.
          kpiSetHash: null,
        },
        select: { id: true },
      });
    } catch (error) {
      // Two tabs, one signature. The unique constraint is the arbiter and the
      // loser reports success — the party HAS signed, which is what was asked.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return ok({ state, signedParties: [...signed, party], alreadySigned: true });
      }
      throw error;
    }

    return created({ state, signedParties: [...signed, party], alreadySigned: false });
  }),
  { id: "pms-signoff-write", limit: 30, windowMs: 60_000 },
);
