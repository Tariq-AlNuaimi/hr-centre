import { z } from "zod";

/**
 * §5.4's escalation capture, bounded at the boundary.
 *
 * These three fields are the only personal data a ticket collects. Since
 * ADR-075 they arrive from Siraaj's language model over MCP — an untrusted hop
 * however trusted Siraaj itself is — so nothing here is optional or lenient.
 *
 * @public
 */

/** A real name, not a paragraph. Long enough for a full Omani name with titles. */
const ESCALATION_NAME_MAX = 120;

/**
 * §7.2 sizing: a real HR question is a sentence or two. 2,000 characters is
 * generous for that and small enough not to stuff a row or an email. The ONE
 * bound on an employee's free text — the reply and queue schemas import it (it
 * lived in the retired chat schema until ADR-075).
 */
export const ESCALATION_QUESTION_MAX = 2000;

/**
 * §5.4 step 2 says "work email", and every address in the spec is `@rihal.om`.
 *
 * Checked rather than assumed, because this address is what the approved answer
 * is SENT to (§5.4 step 6) — an unvalidated domain here means HR's approved
 * answer, written for one employee, is delivered to whatever address a stranger
 * typed. Transformation Pioneers staff are on `@tp.rihal.om` (seen in Siraaj's
 * user directory, 2026-10-24); every other company uses `@rihal.om`.
 */
const WORK_EMAIL_DOMAINS = ["rihal.om", "tp.rihal.om"] as const;

export const workEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .email()
  .refine(
    (value) => WORK_EMAIL_DOMAINS.some((d) => value.endsWith(`@${d}`)),
    `Use your work email (${WORK_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ")}).`,
  );

export const escalationCaptureSchema = z.object({
  employeeName: z.string().trim().min(2).max(ESCALATION_NAME_MAX),
  employeeEmail: workEmailSchema,
  question: z.string().trim().min(5).max(ESCALATION_QUESTION_MAX),
  /** What they said their directorate is, so §5.4 step 3 can route it. */
  directorate: z.string().trim().max(120).optional(),
  /** Their company, if §3.5's selector or the conversation established one. */
  company: z.string().trim().max(120).optional(),
});

export type EscalationCapture = z.infer<typeof escalationCaptureSchema>;

/**
 * HR raises a ticket on an employee's behalf (POST /api/hive/escalations). The
 * name, email and placement come from the employee record, never the form.
 */
export const raiseForEmployeeSchema = z.object({
  employeeId: z.string().trim().min(1).max(64),
  question: z
    .string()
    .trim()
    .min(5, "Write the question in at least 5 characters.")
    .max(ESCALATION_QUESTION_MAX, `Keep the question to ${ESCALATION_QUESTION_MAX} characters.`),
});

export type RaiseForEmployeeInput = z.infer<typeof raiseForEmployeeSchema>;

/** The employee picker on the raise form (GET /api/hive/employees). */
export const ticketEmployeeQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  id: z.string().trim().min(1).max(64).optional(),
});
