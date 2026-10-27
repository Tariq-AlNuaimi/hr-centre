import { z } from "zod";
import { ESCALATION_QUESTION_MAX } from "./escalation";
import { isoDaySchema, muscatDayStart } from "./reports";

/**
 * The HR-side escalation routes, bounded at the boundary.
 *
 * These are authenticated (§5.2's seven accounts), so the threat model is
 * different from the anonymous surface — but the draft answer is text an
 * employee will receive over Rihal HR's name, which makes its bounds a content
 * concern rather than only a security one.
 *
 * @public
 */

/**
 * Long enough for a real answer with a caveat, short enough not to be an essay.
 *
 * Module-private: it is used once, in the schema below, and nothing outside this
 * file has ever needed the number. An exported constant that no caller reads is
 * a fork-facing promise nobody asked for.
 */
const DRAFT_ANSWER_MAX = ESCALATION_QUESTION_MAX * 3;

export const draftAnswerSchema = z.object({
  draftAnswer: z.string().trim().min(1).max(DRAFT_ANSWER_MAX),
});

/**
 * An approver's reason for returning a draft. Optional — "returned" alone is a
 * signal — but bounded, because the drafter reads it in the ticket history.
 */
export const returnToDraftSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const escalationQuerySchema = z
  .object({
    status: z
      .enum([
        "OPEN",
        "IN_PROGRESS",
        "PENDING_APPROVAL",
        "APPROVED",
        "SENT",
        "SEND_FAILED",
        "CLOSED",
      ])
      .optional(),
    cursor: z.string().trim().max(64).optional(),
    // US-T6's filters. Each is opt-in: with none set the queue is still the one
    // shared, company-wide list AC-10.1 describes.
    pairId: z.string().trim().min(1).max(64).optional(),
    source: z.enum(["HIVE", "SIRAAJ"]).optional(),
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
    q: z.string().trim().max(100).optional(),
    /** UX P1 (tickets P1-2): Mine / Unassigned / Overdue. */
    view: z.enum(["mine", "unassigned", "overdue"]).optional(),
  })
  .transform(({ from, to, q, ...rest }) => ({
    ...rest,
    q: q || undefined,
    // Inclusive Muscat days → a half-open instant range, as the report uses.
    gte: from ? muscatDayStart(from) : undefined,
    lt: to ? new Date(muscatDayStart(to).getTime() + 86_400_000) : undefined,
  }));

/** UX P1 (tickets P1-2): assign a ticket to a drafter in its pair, or clear it. */
export const assigneeSchema = z.object({
  assigneeId: z.string().trim().min(1).max(64).nullable(),
});

/** UX P1 (tickets P1-4): a saved reply. Pair-specific when `hrPairId` is set. */
export const savedReplySchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  hrPairId: z.string().trim().min(1).max(64).nullable(),
});
export const savedRepliesQuerySchema = z.object({
  pairId: z.string().trim().min(1).max(64).optional(),
});
