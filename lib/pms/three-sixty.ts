import { Prisma } from "@/generated/prisma/client";
import type { AssessmentType, RoleTrack } from "@/generated/prisma/client";
import { isGoalSettingExempt } from "./cycle";

/**
 * §9 — the 360 assessment module.
 *
 * Pure rules and arithmetic. Assignment generation, execution and results all
 * funnel through here so the three of them cannot disagree about what "three
 * raters" or "the ratio" means.
 */

// §9.3's scale lives in a leaf module so the §9.7 answering form can import it
// without pulling this file's `./cycle` -> `lib/prisma` chain into the browser.
// Re-exported here so every existing server-side import keeps working.
export { ANSWER_SCALE, MAX_ANSWER, isAnswerScore } from "./three-sixty-scale";
import { MAX_ANSWER, isAnswerScore } from "./three-sixty-scale";

/** §9.4 — "Raters — exactly 3 per employee". */
export const RATERS_PER_EMPLOYEE = 3;

/**
 * §9.2 — which template a rater fills in, decided by their relationship to the
 * ratee rather than chosen by hand.
 *
 * "Employee → Line Manager (a reportee assessing their manager uses this
 * template; employee = reportee)" — so the type names the DIRECTION, and the
 * same two people generate different templates depending on who is assessing
 * whom. Getting this from the relationship rather than from a dropdown is what
 * stops a peer form being used on a manager.
 */
export function templateTypeFor(params: {
  rater: { id: string; managerId: string | null };
  ratee: { id: string; managerId: string | null };
}): AssessmentType | null {
  const { rater, ratee } = params;
  if (rater.id === ratee.id) return null; // nobody assesses themselves
  if (ratee.managerId === rater.id) return "LINE_MANAGER_TO_EMPLOYEE";
  if (rater.managerId === ratee.id) return "EMPLOYEE_TO_LINE_MANAGER";
  return "PEER_TO_PEER";
}

/**
 * §8.3 — "C-Level skip goal-setting, self-assessment, and 360 entirely."
 *
 * They are neither assessed nor asked to assess: the exemption is about the
 * WORK, and a C-Level rater would be doing 360 work §8.3 excuses them from.
 */
export function isThreeSixtyExempt(roleTrack: RoleTrack): boolean {
  return isGoalSettingExempt(roleTrack);
}

export type RaterCandidate = {
  id: string;
  managerId: string | null;
  roleTrack: RoleTrack;
  departmentId: string | null;
  status: string;
};

/**
 * §9.4's ladder, applied to one ratee: line manager (mandatory), one peer
 * (mandatory), then a direct reportee if there is one, else a second peer.
 *
 * Returns fewer than three when the org cannot supply them — a sole employee in
 * a one-person department with no reports has no second peer to draw on. That is
 * reported rather than papered over: §9.4 says "exactly 3", so HR needs to SEE
 * the shortfall and fix it (§9.6 lets them edit assignments), and
 * `activationBlockedReason` refuses to launch a cycle that still has one.
 *
 * `peerPool` is supplied by the caller because §9.4 allows two sources — the
 * same department, or "someone they worked with on a project" (§9.6) — and which
 * pool applies is a data question, not a rule question.
 */
export function proposeRaters(params: {
  ratee: RaterCandidate;
  lineManager: RaterCandidate | null;
  reports: readonly RaterCandidate[];
  peerPool: readonly RaterCandidate[];
}): { raterIds: string[]; shortfall: number } {
  const { ratee, lineManager, reports, peerPool } = params;

  const eligible = (c: RaterCandidate | null): c is RaterCandidate =>
    c !== null && c.id !== ratee.id && c.status === "ACTIVE" && !isThreeSixtyExempt(c.roleTrack);

  const chosen: string[] = [];
  const take = (c: RaterCandidate | null) => {
    if (eligible(c) && !chosen.includes(c.id)) chosen.push(c.id);
  };

  // 1. Line manager — mandatory.
  take(lineManager);

  // 2. Peer — mandatory.
  const peers = peerPool.filter(eligible);
  take(peers[0] ?? null);

  // 3. A direct reportee if available; otherwise a second peer.
  const reportee = reports.filter(eligible)[0] ?? null;
  if (reportee) take(reportee);
  else take(peers.find((p) => !chosen.includes(p.id)) ?? null);

  return { raterIds: chosen, shortfall: Math.max(0, RATERS_PER_EMPLOYEE - chosen.length) };
}

export type AssignmentCount = { rateeId: string; raterCount: number };

/**
 * §9.7 — why a 360 cycle may not be ACTIVATED yet, or null.
 *
 * Checked at activation rather than on every edit, because §9.6 has HR building
 * and revising assignments before launch: refusing to save a half-built set
 * would make the review step impossible. The count is what §9.4 demands, so it
 * is demanded at the moment the cycle becomes real.
 */
export function activationBlockedReason(params: {
  templates: readonly { type: AssessmentType; questionCount: number }[];
  counts: readonly AssignmentCount[];
  participantCount: number;
}): string | null {
  const { templates, counts, participantCount } = params;

  // §9.2 — three types, each with its own template.
  const types: AssessmentType[] = [
    "LINE_MANAGER_TO_EMPLOYEE",
    "EMPLOYEE_TO_LINE_MANAGER",
    "PEER_TO_PEER",
  ];
  const missing = types.filter((t) => !templates.some((tpl) => tpl.type === t));
  if (missing.length > 0) {
    return `§9.2 needs a question template for each assessment type. Missing: ${missing.join(", ")}.`;
  }
  const empty = templates.filter((t) => t.questionCount === 0);
  if (empty.length > 0) {
    return `A template with no questions cannot be answered — ${empty.map((t) => t.type).join(", ")}.`;
  }

  if (participantCount === 0) {
    return "No one is enrolled in this 360 cycle yet (§9.6 — generate assignments first).";
  }

  // §9.4 — exactly three raters each. Both directions are wrong: too few leaves
  // §9.5 averaging over a different denominator than the spec states; too many
  // means someone was assigned twice by hand.
  const short = counts.filter((c) => c.raterCount < RATERS_PER_EMPLOYEE);
  if (short.length > 0) {
    return (
      `§9.4 requires exactly ${RATERS_PER_EMPLOYEE} raters per employee. ` +
      `${short.length} employee(s) have fewer — assign the missing raters before activating.`
    );
  }
  const over = counts.filter((c) => c.raterCount > RATERS_PER_EMPLOYEE);
  if (over.length > 0) {
    return (
      `§9.4 requires exactly ${RATERS_PER_EMPLOYEE} raters per employee. ` +
      `${over.length} employee(s) have more — remove the extra assignments before activating.`
    );
  }
  return null;
}

export type ScoredResponse = { score: number | null; scored: boolean };

/**
 * §9.5 — one assessment's ratio: "sum the answered question scores → actual
 * score. Divide by that form's full/maximum possible score → a ratio (0–1)."
 *
 * The denominator is the form's MAXIMUM — every scored question at 4 — not the
 * number answered. A rater who skips half the form has produced a low ratio, not
 * a ratio over what they bothered with, and §9.7's status tracking exists so
 * that shows up as unfinished rather than as a poor assessment.
 *
 * Returns null when the form has no scored questions at all, which is a template
 * problem rather than a result.
 */
export function formRatio(responses: readonly ScoredResponse[]): Prisma.Decimal | null {
  const scored = responses.filter((r) => r.scored);
  if (scored.length === 0) return null;

  const max = new Prisma.Decimal(scored.length).times(MAX_ANSWER);
  let actual = new Prisma.Decimal(0);
  for (const r of scored) {
    if (r.score === null) continue; // unanswered contributes nothing, but still counts in max
    if (!isAnswerScore(r.score)) {
      throw new RangeError(`§9.3: ${r.score} is not on the 4-point scale`);
    }
    actual = actual.plus(r.score);
  }
  return actual.div(max);
}

/**
 * §9.5 — "Average the 3 ratios → the employee's overall 360 ratio."
 *
 * Averages over the ratios SUPPLIED. §9.4 guarantees three and
 * `activationBlockedReason` enforces it at launch, so a shorter list here means
 * a rater left mid-cycle (§12.1) and HR has not yet reassigned — averaging over
 * two is the honest reading of what exists, and the alternative (dividing by a
 * hard 3) would silently penalise the ratee for someone else's departure.
 */
export function overallRatio(ratios: readonly Prisma.Decimal[]): Prisma.Decimal | null {
  if (ratios.length === 0) return null;
  let sum = new Prisma.Decimal(0);
  for (const r of ratios) sum = sum.plus(r);
  return sum.div(ratios.length);
}

/** One submitted form as §13.1's consolidation needs to see it. */
export type SubmittedForm = {
  responses: readonly { score: number | null; text: string | null; questionId: string }[];
  questions: readonly { id: string; scored: boolean }[];
};

/**
 * §13.1 — the consolidated 360 figure and the combined written comments.
 *
 * Pure, and separated from the route on purpose: the anonymity rule is a
 * property of the SHAPE returned, and a shape is testable. Comments come back
 * as a flat, sorted list of strings — no rater, no assignment id, no per-form
 * grouping — so nothing downstream can reassemble one person's form even by
 * accident. Sorting is part of the guarantee, not presentation: submission
 * order would otherwise leak who answered when.
 *
 * The level is the overall ratio × 5 (§8.5), or null when no form scored.
 *
 * ## The anonymity floor — why comments can come back withheld
 *
 * §13.1's parenthesis is not decoration: comments are combined "**protecting
 * anonymity**". §9.4 fixes the rater set at exactly three and NAMES two of the
 * roles — line manager (mandatory) and peer (mandatory) — so the ratee already
 * knows who was in the pool. A single returned comment is therefore attributable
 * by elimination, most sharply to the line manager, whose participation is
 * guaranteed. Pooling one comment is not consolidation; it is a forwarded note
 * with the sender's name torn off.
 *
 * So below `MIN_FORMS_FOR_COMMENTS` submitted forms the comments are WITHHELD and
 * the caller is told they were, rather than being handed an empty list it would
 * render as "nobody wrote anything". The two are different facts and an employee
 * deserves the true one.
 *
 * The threshold counts SUBMITTED FORMS, not comments. Three raters of whom one
 * wrote something is a pool of three and stays anonymous; two raters who both
 * wrote is a pool of two and does not become less anonymous because the text is
 * longer. It is the size of the pool that protects the writer.
 *
 * The SCORE is unaffected and still published: §9.5 averages the ratios that came
 * back, HR sees the rater count at calibration (F8) and holds §13.2's publish
 * gate, so a thin cycle is already visible to the people who decide whether to
 * release it. Withholding a figure the formula has already used would read as
 * data being hidden from the employee rather than as protection for a colleague.
 *
 * Operator decision, 2026-08-26, on red-team finding R3. The specification names
 * no threshold; this is the one Rihal chose.
 */

/**
 * Fewest submitted forms whose comments can be pooled and still be anonymous.
 *
 * Two, not three: three is §9.4's design and the strictest reading, but in a real
 * cycle a rater leaves (§12.1) or misses the window often enough that a floor of
 * three would withhold most written feedback in the product — which is its own
 * failure, just a quieter one.
 */
const MIN_FORMS_FOR_COMMENTS = 2;

export function consolidateThreeSixty(forms: readonly SubmittedForm[]): {
  level: Prisma.Decimal | null;
  comments: string[];
  /** How many forms came back — what the floor above is measured against. */
  submittedForms: number;
  /** True when comments EXIST but are held back for anonymity, not absent. */
  commentsWithheld: boolean;
} {
  const ratios: Prisma.Decimal[] = [];
  const comments: string[] = [];
  for (const form of forms) {
    const answered = new Map(form.responses.map((r) => [r.questionId, r.score]));
    const ratio = formRatio(
      form.questions.map((q) => ({
        scored: q.scored,
        score: q.scored ? (answered.get(q.id) ?? null) : null,
      })),
    );
    if (ratio) ratios.push(ratio);
    for (const r of form.responses) {
      const text = r.text?.trim();
      if (text) comments.push(text);
    }
  }
  const overall = overallRatio(ratios);
  // "Withheld" means there was something to show and we are choosing not to.
  // An employee whose three raters all left the text box empty gets the honest
  // empty state, not a privacy notice implying feedback is being kept from them.
  const withheld = forms.length < MIN_FORMS_FOR_COMMENTS && comments.length > 0;
  return {
    level: overall ? overall.times(5) : null,
    comments: withheld ? [] : comments.sort((a, b) => a.localeCompare(b)),
    submittedForms: forms.length,
    commentsWithheld: withheld,
  };
}

/**
 * §9.7 — "Status tracking per evaluator: Not Started / In Progress / Submitted /
 * **Overdue**."
 *
 * Four statuses, three of them stored. Overdue is DERIVED from the deadline
 * rather than written by a job, for the same reason §5.4's lock is: a stored
 * "overdue" is a second source of truth about the clock, and it is wrong for
 * however long it takes the job to run — or forever, if HR moves the deadline.
 *
 * A submitted assignment is never overdue, whenever it arrived: §9.7 tracks who
 * still owes an assessment, and someone who has answered owes nothing.
 */
export type EvaluatorStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "OVERDUE";

export function evaluatorStatus(params: {
  stored: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED";
  deadline: Date;
  now: Date;
}): EvaluatorStatus {
  const { stored, deadline, now } = params;
  if (stored === "SUBMITTED") return "SUBMITTED";
  return now > deadline ? "OVERDUE" : stored;
}

/** §9.7's "automated reminders before deadline" — the same 7-day window §5.5 uses. */
export const THREE_SIXTY_REMINDER_DAYS = 7;

export function isReminderDue(params: { deadline: Date; now: Date }): boolean {
  const { deadline, now } = params;
  if (now > deadline) return false; // past the deadline it is an overdue, not a reminder
  return deadline.getTime() - now.getTime() <= THREE_SIXTY_REMINDER_DAYS * 86_400_000;
}
