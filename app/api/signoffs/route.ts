import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { GOAL_SETTING_STAGE, signOffBlockedReason } from "@/lib/pms/kpi";
import {
  contextBlockedReason,
  loadSignOffContext,
  signerBlockedReason,
  type SignOffState,
} from "@/lib/pms/signoff";

/**
 * Sign-off — spec §5.1 and §5.3.
 *
 * POST is the ONLY verb here, and that is a spec requirement rather than an
 * omission. §5.3: "If the employee does not agree, they simply do not sign.
 * There is no 'reject' button — the unsigned state is the signal." A DELETE
 * would be that reject button wearing a different name: it would let a party
 * withdraw agreement without any record of the disagreement, which is exactly
 * the offline conversation the spec wants instead. If a signature was given in
 * error, the correction path is Phase 3's audited change request (§6.2).
 *
 * Signing is NOT a lock (§5.1 — HR approval is), so a signature never blocks
 * further edits and neither signature has to come first.
 */

// Boundary validation. Inline rather than in lib/validations/ only because that
// directory is owned elsewhere in this phase; the shape is two ids and belongs
// beside them either way.
const signOffSchema = z.object({
  participantId: z.string().min(1, "participantId is required"),
  party: z.enum(["EMPLOYEE", "MANAGER"]),
});

/** The state after this party signs, without a second round trip to read it back. */
function withParty(state: SignOffState, party: "EMPLOYEE" | "MANAGER"): SignOffState {
  return party === "EMPLOYEE"
    ? { ...state, employeeSigned: true }
    : { ...state, managerSigned: true };
}

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = signOffSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { participantId, party } = parsed.data;

    const actor = await resolveActor(session);
    const ctx = await loadSignOffContext(participantId);
    if (!ctx) return notFound("Participant");

    // Authority first, then state: a stranger must not learn from the error
    // message how complete someone else's KPI set is.
    const blockedSigner = signerBlockedReason({ actor, party, subject: ctx.subject });
    if (blockedSigner) {
      // 404 rather than 403 when the caller has no relationship to the subject —
      // §4.2's existence oracle, same as every other write route in the phase.
      return blockedSigner.status === 404
        ? notFound("Participant")
        : forbidden(blockedSigner.reason);
    }

    const contextBlocked = contextBlockedReason(ctx);
    if (contextBlocked) return err(contextBlocked, 409);
    const stage = ctx.stage;
    if (!stage) return err("This cycle has no goal-setting stage configured.", 409);

    // Idempotent by design (see the file comment): a second POST is the same
    // statement as the first, so it reports the existing signature at 200.
    const existing = await prisma.signOff.findUnique({
      where: {
        participantId_stageKind_party: { participantId, stageKind: GOAL_SETTING_STAGE, party },
      },
      select: { id: true, party: true, signedByEmployeeId: true, signedAt: true },
    });
    if (existing) {
      return ok({
        signOff: { ...existing, participantId },
        state: ctx.state,
        alreadySigned: true,
      });
    }

    // §5.3 — the 100% rule and §5.4's hard lock, in one shared predicate so the
    // drafting UI, this route and HR's approval cannot disagree about what
    // "signable" means.
    const blocked = signOffBlockedReason({ kpis: ctx.kpis, stage, now: new Date() });
    if (blocked) return err(blocked, 409);

    const signerId = actor.employeeId;
    if (!signerId) return forbidden("This account has no linked employee record (ADR-065).");

    try {
      const signOff = await prisma.signOff.create({
        // The digest is what this party is agreeing TO. US-12 lets the set move
        // afterwards; recording what it looked like is the only way anyone can
        // later tell that it did.
        data: {
          participantId,
          // Named explicitly rather than left to the column default: this
          // route is the §5.1 goal-setting signature, and §7.1's year-end one
          // will be a different route writing YEAR_END on the same key.
          stageKind: GOAL_SETTING_STAGE,
          party,
          signedByEmployeeId: signerId,
          kpiSetHash: ctx.currentKpiSetHash,
        },
        select: { id: true, party: true, signedByEmployeeId: true, signedAt: true },
      });
      return created({
        signOff: { ...signOff, participantId },
        state: withParty(ctx.state, party),
        alreadySigned: false,
      });
    } catch (error) {
      // Two tabs, one signature. The unique constraint is the arbiter and the
      // loser reports success -- the party HAS signed, which is all the caller
      // asked about.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const row = await prisma.signOff.findUnique({
          where: {
            participantId_stageKind_party: {
              participantId,
              stageKind: GOAL_SETTING_STAGE,
              party,
            },
          },
          select: { id: true, party: true, signedByEmployeeId: true, signedAt: true },
        });
        if (row) {
          return ok({
            signOff: { ...row, participantId },
            state: withParty(ctx.state, party),
            alreadySigned: true,
          });
        }
      }
      throw error;
    }
  }),
  { id: "pms-signoff-write", limit: 30, windowMs: 60_000 },
);
