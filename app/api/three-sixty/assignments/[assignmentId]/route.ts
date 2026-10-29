import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/core/actor";
import { isHr } from "@/lib/core/permissions";
import { templateTypeFor } from "@/lib/pms/three-sixty";
import {
  discardBlockedReason,
  discardDestroysAnswers,
  raterChangeBlockedReason,
} from "@/lib/pms/three-sixty-edit";
import {
  THREE_SIXTY_CANDIDATE_SELECT,
  raterEligibilityRefusal,
} from "@/lib/pms/three-sixty-raters";
import { discardAssignmentSchema, replaceRaterSchema } from "@/lib/validations/three-sixty";

/**
 * §9.4 — one rater assignment, changed AFTER the cycle has launched.
 *
 *   PATCH  — replace the rater on an unsubmitted assignment
 *   DELETE — remove it, or discard a submitted assessment with a reason
 *
 * ## Why per-assignment, and not the existing per-ratee writer
 *
 * `POST /api/three-sixty/assignments` replaces a ratee's whole set wholesale,
 * which is the right shape for §9.6's pre-launch review and catastrophic once a
 * cycle is live: it deletes every assignment for that person, including ones
 * their raters are part-way through. Both existing writers therefore refuse
 * anything but a DRAFT cycle, which left §9.4's "HR selects and **manages** all
 * rater assignments" with no way to manage anything after launch.
 *
 * That gap had already escaped into a promise. `RecordDepartureDialog` tells HR,
 * before they record a §12.1 departure, how many of the leaver's 360
 * assignments "will need a new rater" — and for a leaver mid-cycle those sit in
 * an ACTIVE cycle, where nothing would accept the change. This route is what
 * makes that sentence true.
 *
 * ## Submitted answers are not re-pointed at a new name
 *
 * The operator's suggestion was that a submitted assessment be locked and
 * reassignable with a logged reason. Locked, yes — but a rater swap on answers
 * somebody else gave is not a reassignment, it is a falsified assessment, and
 * §9.3's scores are what §8.5 carries into pay. So `PATCH` refuses outright and
 * the remedy is `DELETE` with a mandatory reason: the answers come out of
 * §9.5's average and go into the audit row, and the replacement rater starts
 * from a blank form. The rules themselves are in `lib/pms/three-sixty-edit.ts`
 * so the screen can explain the refusal before HR clicks it.
 */

/** Everything both verbs need to decide, in one read. */
async function loadAssignment(assignmentId: string) {
  return prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      status: true,
      rateeId: true,
      raterId: true,
      threeSixtyCycleId: true,
      ratee: { select: THREE_SIXTY_CANDIDATE_SELECT },
      rater: { select: { id: true, name: true } },
      threeSixtyCycle: {
        select: {
          id: true,
          status: true,
          cycle: { select: { status: true } },
          templates: { select: { id: true, type: true } },
        },
      },
    },
  });
}

export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR manages rater assignments.", 403);

    const { assignmentId } = await params;

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = replaceRaterSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { raterId, reason } = parsed.data;

    const assignment = await loadAssignment(assignmentId);
    if (!assignment) return notFound("Assignment");

    const blocked = raterChangeBlockedReason({
      cycleStatus: assignment.threeSixtyCycle.status,
      performanceYearStatus: assignment.threeSixtyCycle.cycle.status,
      assignmentStatus: assignment.status,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    if (raterId === assignment.raterId) {
      return err("That is already this assessment's rater.", 409);
    }

    const rater = await prisma.employee.findUnique({
      where: { id: raterId },
      select: THREE_SIXTY_CANDIDATE_SELECT,
    });
    if (!rater) return notFound("Rater");

    // §8.3, §12.1 and §7.1, from the shared rules the pre-launch writer uses.
    const ineligible = raterEligibilityRefusal({ raters: [rater], rateeId: assignment.rateeId });
    if (ineligible) return err(ineligible.reason, ineligible.status);

    // §9.4's "exactly 3" is per ratee, and the unique index is per
    // (cycle, ratee, rater) — so a rater already assessing this person would
    // collide. Answered with a sentence rather than a constraint violation.
    const duplicate = await prisma.assignment.findFirst({
      where: {
        threeSixtyCycleId: assignment.threeSixtyCycleId,
        rateeId: assignment.rateeId,
        raterId,
      },
      select: { id: true },
    });
    if (duplicate) {
      return err("That person is already assessing this employee.", 409);
    }

    // §9.2's template follows the RELATIONSHIP, not the old assignment: a peer
    // standing in for a departed line manager fills a peer form, and carrying
    // the previous `templateId` over would have them answer the wrong
    // questionnaire — the exact thing `templateTypeFor` exists to prevent.
    const type = templateTypeFor({ rater, ratee: assignment.ratee });
    if (type === null) {
      return err("Nobody assesses themselves — §7.1 is where a self-assessment lives.", 400);
    }
    const templateId = assignment.threeSixtyCycle.templates.find((t) => t.type === type)?.id;
    if (!templateId) {
      return err(
        `This 360 cycle has no ${type.toLowerCase().replaceAll("_", " ")} template, so that ` +
          "person cannot assess this employee.",
        409,
      );
    }

    // Whatever the PREVIOUS rater had typed. Read before the swap, because the
    // rows go with it and this is the only moment they exist to be recorded —
    // the same reason the discard path captures its answers. A part-finished
    // form is that person's words about this ratee; it must not be handed to
    // somebody else, and it must not vanish unrecorded either.
    const previousAnswers = await prisma.assignmentResponse.findMany({
      where: { assignmentId },
      take: 60,
      select: { questionId: true, score: true, text: true },
    });

    const updated = await auditedTransaction(async (tx) => {
      const row = await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          raterId,
          templateId,
          // A part-finished form belongs to the previous rater. The new one
          // starts clean, and the status has to say so or §9.7's tracking shows
          // "In Progress" for somebody who has not opened it.
          status: "NOT_STARTED",
        },
        select: {
          id: true,
          status: true,
          rater: { select: { id: true, name: true } },
          template: { select: { type: true } },
        },
      });
      // The single-row update is audited by the extension, but the REASON and
      // the discarded part-answers are not columns on it, so they are recorded
      // alongside. Written unconditionally when anything was lost: a swap that
      // threw away a half-filled form and says so only when HR happened to
      // type a reason is not a trail.
      if (reason || previousAnswers.length > 0) {
        await recordAudit(tx, {
          entityType: "Assignment",
          entityId: assignmentId,
          action: "UPDATE",
          before: {
            raterId: assignment.raterId,
            raterName: assignment.rater.name,
            status: assignment.status,
            answerCount: previousAnswers.length,
            answers: previousAnswers,
          },
          after: { raterId, status: "NOT_STARTED", reason: reason ?? null },
        });
      }
      // Inside the transaction, so the swap and the loss of the old rater's
      // part-answers commit together — and after the audit row above, which
      // is what preserves them.
      // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- recordAudit() above carries the answers and the reason; bounded to one assignment's rows
      await tx.assignmentResponse.deleteMany({ where: { assignmentId } });
      return row;
    });

    return ok({ assignment: updated, previousAnswersDiscarded: previousAnswers.length });
  }),
  { id: "pms-360-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR manages rater assignments.", 403);

    const { assignmentId } = await params;

    // DELETE may carry a body; an absent one is fine for an unsubmitted
    // assignment and refused below for a submitted one.
    const body = await readJsonBody(request);
    const parsed = discardAssignmentSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { reason } = parsed.data;

    const assignment = await loadAssignment(assignmentId);
    if (!assignment) return notFound("Assignment");

    const blocked = discardBlockedReason({
      cycleStatus: assignment.threeSixtyCycle.status,
      performanceYearStatus: assignment.threeSixtyCycle.cycle.status,
      assignmentStatus: assignment.status,
      reason,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    const destroys = discardDestroysAnswers(assignment.status);

    // Read the answers BEFORE deleting. `AssignmentResponse` cascades with the
    // assignment, so this is the only moment they exist to be recorded, and a
    // destructive act whose trail does not say what it destroyed is not a
    // trail. The same reason the bulk regenerate captures its count.
    const answers = destroys
      ? await prisma.assignmentResponse.findMany({
          where: { assignmentId },
          take: 60,
          select: { questionId: true, score: true, text: true },
        })
      : [];

    await auditedTransaction(async (tx) => {
      await recordAudit(tx, {
        entityType: "Assignment",
        entityId: assignmentId,
        action: "DELETE",
        before: {
          rateeId: assignment.rateeId,
          raterId: assignment.raterId,
          raterName: assignment.rater.name,
          status: assignment.status,
          answerCount: answers.length,
          // The words themselves, so a discarded assessment is recoverable
          // from the audit log by a person even though the rows are gone.
          answers,
        },
        after: { discarded: true, reason: reason ?? null },
      });
      await tx.assignment.delete({ where: { id: assignmentId } });
    });

    // §9.4 wants exactly three. Removing one leaves two, which is a legitimate
    // intermediate state after launch but must not be a surprise at §9.8 — so
    // the answer says where the ratee now stands rather than just "deleted".
    const remaining = await prisma.assignment.count({
      where: {
        threeSixtyCycleId: assignment.threeSixtyCycleId,
        rateeId: assignment.rateeId,
      },
    });

    return ok({
      discarded: assignmentId,
      answersDestroyed: answers.length,
      remainingRaters: remaining,
      shortOfThree: remaining < 3,
    });
  }),
  { id: "pms-360-write", limit: 60, windowMs: 60_000 },
);
