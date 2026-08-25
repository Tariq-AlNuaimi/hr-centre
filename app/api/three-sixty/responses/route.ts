import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isAnswerScore } from "@/lib/pms/three-sixty";
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

    if (assignment.threeSixtyCycle.status !== "ACTIVE") {
      return err(
        assignment.threeSixtyCycle.status === "DRAFT"
          ? "This 360 cycle has not been activated yet (§9.7)."
          : "This 360 cycle is closed (§9.8).",
        409,
      );
    }
    if (now < assignment.threeSixtyCycle.opensAt) {
      return err("This 360 cycle has not opened yet (§9.7).", 409);
    }
    if (now > assignment.threeSixtyCycle.deadline) {
      // §5.4's convention, carried into §9: a deadline is a hard lock.
      return err("The 360 deadline has passed and this assessment is locked (§5.4).", 409);
    }
    if (assignment.status === "SUBMITTED") {
      // §9.7 — "prevent duplicate submissions per assignment".
      return err("This assessment has already been submitted (§9.7).", 409);
    }

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

    await prisma.$transaction(async (tx) => {
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
