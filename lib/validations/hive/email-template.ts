import { z } from "zod";

/**
 * §5.6's admin-editable email text (US11, task 5.3).
 *
 * The bounds here are about what a well-meaning edit can break, not about
 * hostile input: this is behind `canEditContent` and the only people who hold it
 * are Alaa and Muna. What they can do by accident is send an employee a warm,
 * correctly-formatted email containing no answer.
 *
 * @public
 */

export const TEMPLATE_SUBJECT_MAX = 200;
export const TEMPLATE_BODY_MAX = 5000;

/**
 * The four fields §5.6 populates. Anything else in the body stays literal.
 *
 * `{{replyLink}}` is minted on approval (ADR-070, task 5.3b). It can still be
 * absent — a deployment with no `AUTH_URL` has no honest origin to build a link
 * from — and `renderTemplate` then removes the whole LINE containing it rather
 * than leaving a dangling "reply here:". So a template with a reply line is
 * correct either way, which is what lets the line be part of the default.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "{{employeeName}}",
  "{{question}}",
  "{{answer}}",
  "{{hrPairName}}",
  "{{replyLink}}",
  "{{ticketId}}",
] as const;

/**
 * `{{answer}}` is required, and this is the only interesting rule in the file.
 *
 * §5.6 makes the approved answer "the only variable part" of the email. A body
 * that has lost it — deleted while rewording the opening line, most likely —
 * still renders, still sends, and still reads as a complete message. The
 * employee gets a friendly note over Rihal HR's name that answers nothing, and
 * nobody finds out except them. It is the one edit this screen must refuse.
 */
export const emailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(TEMPLATE_SUBJECT_MAX),
  body: z
    .string()
    .trim()
    .min(1)
    .max(TEMPLATE_BODY_MAX)
    .refine((body) => body.includes("{{answer}}"), {
      message:
        "The body must contain {{answer}} — without it the email sends with no answer in it.",
    }),
});

/** Which template. One today; the key exists so a second does not need a route. */
export const templateKeySchema = z.enum(["escalation-answer"]);

/**
 * §5.6's wording, transcribed rather than paraphrased.
 *
 * The spec gives this as prose — "Warm opening line… → the employee's original
 * question, quoted back → the HR-approved answer (the only variable part) →
 * sign-off noting it was reviewed by Rihal HR / the specific HR pair, with an
 * invitation to ask again anytime" (asking is in Siraaj since ADR-075) — and this is that sequence, in that
 * order. It is a starting point for Alaa to edit, not a decision.
 *
 * §5.6's subject placeholder for the assistant's name is resolved to HIVE here
 * because it is not a runtime variable; if it were ever renamed, this row is
 * editable.
 */
export const DEFAULT_TEMPLATE = {
  // Spec V2 §5.7: "Your question to HIVE — Answered (Ticket HIVE-0001)".
  subject: "Your question to HIVE — Answered (Ticket {{ticketId}})",
  body: [
    "Hi {{employeeName}}, thanks for reaching out! Here's the answer to your question:",
    "",
    "> {{question}}",
    "",
    "{{answer}}",
    "",
    "This answer was reviewed by Rihal HR ({{hrPairName}}).",
    "",
    // §5.4's follow-up route (ADR-070). Its own LINE, because `renderTemplate`
    // removes the whole line when no link has been issued — a sentence with the
    // placeholder mid-way would lose its other half with it.
    "Need to follow up? Continue this conversation here: {{replyLink}}",
    "",
    // ADR-075: employees ask Siraaj now; HIVE's own chat is retired.
    "Anything else? Ask Siraaj's HR assistant any time.",
  ].join("\n"),
} as const;
