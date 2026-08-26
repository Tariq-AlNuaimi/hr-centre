import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { formRatio, overallRatio } from "@/lib/pms/three-sixty";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";

/**
 * §9.8 — "Calculate 360 score per employee (§9.5). Consolidate written comments
 * per employee. Generate individual 360 reports."
 *
 * ## Anonymity is structural, not a display choice
 *
 * §13.1: comments are "combined/summarized … not attributed to individual
 * raters, protecting anonymity". So this route never returns which rater wrote
 * which comment — the join simply is not made. Ordering is by question, and
 * within a question the comments arrive in whatever order the database gives
 * them, because a stable per-rater ordering across questions is exactly how a
 * reader reconstructs who said what.
 *
 * Only HR and the executive viewers may read a 360 result (§4.1's org-wide
 * sight). A line manager sees their report's KPI status but not their 360
 * ratio — §13.3 lists "status, scores, and bands" for the manager workspace,
 * and the 360 breakdown is neither, it is component detail (§13.1 keeps that
 * from the employee too).
 */

/**
 * §13.1 — return comments in a shape nothing can be attributed from.
 *
 * Three things have to go, and each of them alone is enough to unpick the
 * clause:
 *
 * 1. **The question label, where a comment stands alone under it.** Comments
 *    come only from unscored questions, and a question belongs to exactly one
 *    template — one rating direction. A single comment under a
 *    `LINE_MANAGER_TO_EMPLOYEE` question is provably the ratee's only line
 *    manager. Where two or more people answered the same question the label is
 *    safe and worth keeping: §9.8 asks for comments to be CONSOLIDATED, and a
 *    heap of unlabelled sentences is not that. "Two or more" means two or more
 *    RATERS, not two or more rows: nothing stops a template from carrying the
 *    same question text twice, and one line manager answering both would
 *    otherwise reach the threshold on their own and keep the label that names
 *    them.
 * 2. **`orderIndex`.** The same org-wide actor can read every template's
 *    questions and their positions from `GET /api/three-sixty`, so a withheld
 *    label is re-derivable from the position it was withheld at.
 * 3. **Every trace of per-rater order — including the group's position.**
 *    This is the subtle one, and it took two attempts. Accumulating by rater
 *    and sorting by question leaves ties in rater order, so two peers
 *    commenting on two questions come back as [P1-A, P2-A, P1-B, P2-B] and the
 *    Nth text under every heading is the same person. Sorting the groups by
 *    `orderIndex` then also preserves the position the label was withheld at —
 *    and the starter set gives all three open-ended questions the same index,
 *    so the tie-break fell back to insertion order, which is rater order
 *    again. So the whole response is ordered by its own CONTENT: by question
 *    label, then by text. Not by randomness, which would make the same data
 *    read differently on every fetch and defeat its own purpose the moment
 *    someone refreshed.
 */
function unattributableComments(
  comments: { question: string; orderIndex: number; text: string; assignmentId: string }[],
): { question: string | null; text: string }[] {
  const raters = new Map<string, Set<string>>();
  for (const c of comments) {
    const seen = raters.get(c.question) ?? new Set<string>();
    seen.add(c.assignmentId);
    raters.set(c.question, seen);
  }

  return comments
    .map((c) => ({
      question: (raters.get(c.question)?.size ?? 0) > 1 ? c.question : null,
      text: c.text,
    }))
    .sort(
      (a, b) => (a.question ?? "").localeCompare(b.question ?? "") || a.text.localeCompare(b.text),
    );
}

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const url = new URL(request.url);
    const threeSixtyCycleId = url.searchParams.get("threeSixtyCycleId");
    const employeeId = url.searchParams.get("employeeId");
    if (!threeSixtyCycleId) return err("threeSixtyCycleId is required");

    if (!actor.capabilities.orgWide) {
      return err("360 results are visible to HR and the executive viewers (§4.1, §13.1).", 403);
    }

    const threeSixty = await prisma.threeSixtyCycle.findUnique({
      where: { id: threeSixtyCycleId },
      select: { id: true, status: true },
    });
    if (!threeSixty) return notFound("360 cycle");

    // One employee, or the whole cycle. The per-employee read is what §9.8's
    // "individual 360 report" needs; the bulk read is what §8.5 consumes when
    // scores are computed.
    const assignments = await prisma.assignment.findMany({
      take: 4000,
      where: {
        threeSixtyCycleId,
        ...(employeeId ? { rateeId: employeeId } : {}),
        // Only SUBMITTED forms count. §9.5 averages "the 3 ratios", and a
        // half-filled draft has no ratio worth carrying into someone's score.
        status: "SUBMITTED",
      },
      select: {
        id: true,
        rateeId: true,
        ratee: { select: { id: true, name: true } },
        responses: {
          select: {
            score: true,
            text: true,
            question: { select: { id: true, scored: true, text: true, orderIndex: true } },
          },
          take: 60,
        },
        template: {
          select: { questions: { select: { id: true, scored: true }, take: 60 } },
        },
      },
    });
    if (employeeId && assignments.length === 0) {
      // Visibility was already established above, so this is a genuine absence.
      const exists = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });
      if (!exists) return notFound("Employee");
    }

    // Guard the per-employee read against the chain rule too, so an HRBP
    // querying one employee gets the same answer the roster would give.
    if (employeeId) {
      const descendants = actor.capabilities.orgWide
        ? new Set<string>()
        : await descendantEmployeeIds(actor.employeeId ?? "");
      if (!canViewEmployee(actor, employeeId, descendants)) return notFound("Employee");
    }

    type Acc = {
      name: string;
      /** SUBMITTED forms, whether or not any of them yielded a ratio. */
      submissions: number;
      ratios: ReturnType<typeof formRatio>[];
      comments: { question: string; orderIndex: number; text: string; assignmentId: string }[];
    };
    const byRatee = new Map<string, Acc>();

    for (const a of assignments) {
      const acc = byRatee.get(a.rateeId) ?? {
        name: a.ratee.name,
        submissions: 0,
        ratios: [],
        comments: [],
      };
      acc.submissions += 1;

      // §9.5 — the denominator is the FORM's maximum: every scored question at
      // 4, whether or not it was answered. Built from the template so a skipped
      // question still counts against the ratio.
      const answered = new Map(a.responses.map((r) => [r.question.id, r.score]));
      const ratio = formRatio(
        a.template.questions.map((q) => ({
          scored: q.scored,
          score: q.scored ? (answered.get(q.id) ?? null) : null,
        })),
      );
      if (ratio !== null) acc.ratios.push(ratio);

      for (const r of a.responses) {
        if (r.text && r.text.trim() !== "") {
          // No rater id, no assignment id — nothing that could be joined back.
          acc.comments.push({
            question: r.question.text,
            orderIndex: r.question.orderIndex,
            text: r.text,
            // Kept only to count DISTINCT raters below, and dropped before the
            // response leaves — see `unattributableComments`.
            assignmentId: a.id,
          });
        }
      }
      byRatee.set(a.rateeId, acc);
    }

    const results = [...byRatee.entries()].map(([rateeId, acc]) => {
      const ratios = acc.ratios.filter((r): r is NonNullable<typeof r> => r !== null);
      const overall = overallRatio(ratios);
      return {
        employeeId: rateeId,
        name: acc.name,
        // §9.4 counts RATERS, so this counts submitted forms — not the ratios
        // they produced. A template of nothing but open-ended questions (which
        // §9.2 allows and the create schema permits) yields no ratio at all,
        // and reporting "0 of 3 raters submitted" for three real submissions
        // would be false where it matters most.
        assessmentCount: acc.submissions,
        /** How many of those forms actually contributed to the average (§9.5). */
        ratedCount: ratios.length,
        // The raw ratio (§9.5) and its §8.5 equivalent, so the caller never has
        // to remember which one the formula wants.
        ratio: overall?.toString() ?? null,
        levelEquivalent: overall ? overall.times(5).toFixed(2) : null,
        comments: unattributableComments(acc.comments),
      };
    });

    return ok({
      threeSixtyCycleId,
      status: threeSixty.status,
      results: results.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }),
  { id: "pms-360-read", limit: 60, windowMs: 60_000 },
);
