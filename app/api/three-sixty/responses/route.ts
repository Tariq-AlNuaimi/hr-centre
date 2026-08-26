import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { evaluatorStatus, isAnswerScore } from "@/lib/pms/three-sixty";
import { answerBlockedReason } from "@/lib/pms/three-sixty-answer";
import { submitResponsesSchema } from "@/lib/validations/three-sixty";

/**
 * §9.7 — "Evaluators complete and submit; prevent duplicate submissions per
 * assignment; store responses securely."
 *
 * Saving is incremental (`submit: false`) so a half-finished form survives a
 * closed tab, and §9.7's IN_PROGRESS status means something real rather than
 * being a label nobody sets. `submit: true` is the one-way door.
 *
 * **Only the assigned rater may answer.** Not HR, not the ratee's manager: a
 * 360 answered by anyone other than the person asked is not a 360, and §13.1's
 * anonymity promise rests on the responses being exactly who they claim to be.
 */

type Answer = { questionId: string; score?: number | null; text?: string | null };
type Question = { id: string; scored: boolean };

/**
 * Whether every answer fits the form it claims to be on, or the sentence saying
 * why not. Pure, and extracted so the handler stays inside the complexity
 * budget — the seam is real: this asks "is this a well-formed answer", the
 * handler asks "may this person answer now".
 */
function answerShapeError(
  answers: readonly Answer[],
  questions: Map<string, Question>,
): string | null {
  for (const a of answers) {
    const q = questions.get(a.questionId);
    if (!q) return "An answer names a question that is not on this form.";
    const hasScore = a.score !== undefined && a.score !== null;
    if (q.scored && hasScore && !isAnswerScore(a.score as number)) {
      return "§9.3: answers are on the forced 4-point scale, 1 to 4.";
    }
    if (!q.scored && hasScore) {
      // §9.5 sums "the answered question scores"; an open-ended question has
      // none, and letting one carry a score would quietly change the maximum.
      return "An open-ended question takes text, not a score (§9.2).";
    }
  }
  return null;
}

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const now = new Date();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = submitResponsesSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { assignmentId, answers, submit } = parsed.data;

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        raterId: true,
        status: true,
        threeSixtyCycle: { select: { status: true, opensAt: true, deadline: true } },
        template: {
          select: {
            questions: { select: { id: true, scored: true }, take: 60 },
          },
        },
      },
    });
    if (!assignment) return notFound("Assignment");

    // 404 rather than 403: an assignment id must not tell someone that a 360
    // exists for a colleague they were not asked about (§4.2's convention).
    if (actor.employeeId === null || actor.employeeId !== assignment.raterId) {
      return notFound("Assignment");
    }

    // Shared with the GET below, so the form the rater is shown and the write
    // that accepts it cannot disagree about whether they may answer.
    const blocked = answerBlockedReason({
      cycleStatus: assignment.threeSixtyCycle.status,
      opensAt: assignment.threeSixtyCycle.opensAt,
      deadline: assignment.threeSixtyCycle.deadline,
      assignmentStatus: assignment.status,
      now,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    const questions = new Map(assignment.template.questions.map((q) => [q.id, q]));
    const shapeError = answerShapeError(answers, questions);
    if (shapeError) return err(shapeError, 400);

    // §9.7 — a submitted form must be COMPLETE on its scored questions.
    // Otherwise §9.5's ratio (actual ÷ the form's maximum) silently reports a
    // half-finished assessment as a poor one.
    if (submit) {
      const answeredScored = new Set(
        answers.filter((a) => a.score !== undefined && a.score !== null).map((a) => a.questionId),
      );
      const existing = await prisma.assignmentResponse.findMany({
        where: { assignmentId, score: { not: null } },
        // A form is at most 60 questions (the boundary caps it), so this is a
        // guard rather than a page.
        take: 60,
        select: { questionId: true },
      });
      for (const e of existing) answeredScored.add(e.questionId);

      const missing = assignment.template.questions.filter(
        (q) => q.scored && !answeredScored.has(q.id),
      );
      if (missing.length > 0) {
        return err(
          `${missing.length} scored question(s) still need an answer before you can submit — ` +
            `§9.5 divides by the whole form, so a gap reads as a low score rather than as unfinished.`,
          409,
        );
      }
    }

    await auditedTransaction(async (tx) => {
      for (const a of answers) {
        const score = a.score ?? null;
        const text = a.text?.trim() ? a.text.trim() : null;
        // Both null would be an unanswered question; the DB refuses it, and
        // skipping is the honest representation of "not answered yet".
        if (score === null && text === null) continue;

        const existing = await tx.assignmentResponse.findUnique({
          where: { assignmentId_questionId: { assignmentId, questionId: a.questionId } },
          select: { id: true },
        });
        if (existing) {
          await tx.assignmentResponse.update({
            where: { id: existing.id },
            data: { score, text },
            select: { id: true },
          });
        } else {
          await tx.assignmentResponse.create({
            data: { assignmentId, questionId: a.questionId, score, text },
            select: { id: true },
          });
        }
      }

      await tx.assignment.update({
        where: { id: assignmentId },
        data: submit ? { status: "SUBMITTED", submittedAt: now } : { status: "IN_PROGRESS" },
        select: { id: true },
      });
    });

    const after = await prisma.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        _count: { select: { responses: true } },
      },
    });
    return ok({ assignment: after });
  }),
  { id: "pms-360-write", limit: 120, windowMs: 60_000 },
);

/**
 * §9.7 — the form itself: the questions this rater was asked, and whatever they
 * have already saved.
 *
 * This read did not exist, and its absence is why §9 had no answering screen.
 * Neither of the two endpoints a rater could already reach carries a form:
 * `/api/three-sixty` returns cycle dates only for a plain employee, and the
 * assignments list gives the template's TYPE, not its questions.
 *
 * **Only the assigned rater.** Not HR, not the ratee's manager, and 404 rather
 * than 403 for everyone else — §4.2's convention, and here it also protects
 * §13.1: an assignment id that answered "yes, that exists" would let someone
 * enumerate who is assessing whom, which is the join anonymity rests on.
 *
 * `blockedReason` is the same function the POST refuses with, so a form that
 * renders is a form that will be accepted.
 */
export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const now = new Date();

    const assignmentId = new URL(request.url).searchParams.get("assignmentId");
    if (!assignmentId) return err("assignmentId is required");

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        status: true,
        raterId: true,
        submittedAt: true,
        ratee: { select: { id: true, name: true } },
        threeSixtyCycle: {
          select: { id: true, status: true, opensAt: true, deadline: true },
        },
        template: {
          select: {
            type: true,
            questions: {
              select: { id: true, text: true, orderIndex: true, scored: true },
              orderBy: { orderIndex: "asc" },
              take: 60,
            },
          },
        },
        responses: { select: { questionId: true, score: true, text: true }, take: 60 },
      },
    });
    if (!assignment) return notFound("Assignment");
    if (actor.employeeId === null || actor.employeeId !== assignment.raterId) {
      return notFound("Assignment");
    }

    const blocked = answerBlockedReason({
      cycleStatus: assignment.threeSixtyCycle.status,
      opensAt: assignment.threeSixtyCycle.opensAt,
      deadline: assignment.threeSixtyCycle.deadline,
      assignmentStatus: assignment.status,
      now,
    });

    return ok({
      assignment: {
        id: assignment.id,
        // §9.7's four statuses, with OVERDUE derived from the server's clock.
        status: evaluatorStatus({
          stored: assignment.status,
          deadline: assignment.threeSixtyCycle.deadline,
          now,
        }),
        ratee: assignment.ratee,
        templateType: assignment.template.type,
        deadline: assignment.threeSixtyCycle.deadline,
        submittedAt: assignment.submittedAt,
        canAnswer: blocked === null,
        blockedReason: blocked?.reason ?? null,
      },
      questions: assignment.template.questions,
      answers: assignment.responses,
    });
  }),
  { id: "pms-360-read", limit: 120, windowMs: 60_000 },
);
