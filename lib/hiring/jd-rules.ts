import type { HiringJdSignatory, HiringJdStatus } from "@/generated/prisma/client";

/**
 * Step 3 — two-signatory JD sign-off, pure (Interview Hub
 * `lib/services/jd-signoff.ts`). DRAFT → SUBMIT → AWAITING_SIGNOFF → two
 * signatures → APPROVED; a request for changes bumps the version and voids
 * every signature on it.
 *
 *  - Hiring-manager slot: exactly the requisition's hiring manager.
 *  - HR slot: HR Manager / HR Specialist / hiring admin — never the hiring
 *    manager, never the drafter of this version, never someone who signed the
 *    other slot.
 */

const JD_SLOTS: HiringJdSignatory[] = ["HIRING_MANAGER", "HR"];

export type JdActor = {
  id: string;
  /** Holds hiring.manage on the requisition. */
  canManage: boolean;
  /** HR Manager / HR Specialist / admin for the requisition's scope. */
  hrEligible: boolean;
};

export type JdContext = {
  jdStatus: HiringJdStatus;
  description?: string | null;
  jdAuthorId: string | null;
  hiringManagerId: string;
  /** Signatures on the CURRENT version. */
  signatures: { signatory: HiringJdSignatory; actorId: string }[];
};

type Result = { ok: true } | { ok: false; reason: string };
const OK: Result = { ok: true };
const no = (reason: string): Result => ({ ok: false, reason });

/** May act on this JD at all (Interview Hub refused VIEWER). */
function hasStanding(actor: JdActor, ctx: JdContext): boolean {
  return actor.canManage || actor.hrEligible || actor.id === ctx.hiringManagerId;
}

function slotEligibility(actor: JdActor, slot: HiringJdSignatory, hmId: string): Result {
  if (slot === "HIRING_MANAGER") {
    return actor.id === hmId
      ? OK
      : no("Only this requisition's hiring manager can sign the hiring-manager slot.");
  }
  if (actor.id === hmId) {
    return no(
      "The hiring manager can't also sign as HR — the two signatures must come from two different people.",
    );
  }
  return actor.hrEligible ? OK : no("Only HR (or a hiring admin) can sign the HR slot.");
}

export function canSignJd(actor: JdActor, slot: HiringJdSignatory, ctx: JdContext): Result {
  if (!hasStanding(actor, ctx)) return no("You don't have permission to sign a job description.");
  if (ctx.jdStatus !== "AWAITING_SIGNOFF") {
    return no(
      ctx.jdStatus === "APPROVED"
        ? "This job description is already signed off."
        : "This job description isn't up for sign-off yet — it has to be submitted first.",
    );
  }
  if (ctx.signatures.some((s) => s.signatory === slot)) {
    return no("That signature is already recorded.");
  }
  const eligible = slotEligibility(actor, slot, ctx.hiringManagerId);
  if (!eligible.ok) return eligible;
  if (ctx.signatures.some((s) => s.actorId === actor.id)) {
    return no(
      "You've already signed this job description — the second signature has to come from someone else (separation of duties).",
    );
  }
  if (slot === "HR" && !ctx.jdAuthorId) {
    return no(
      "Can't verify who drafted this job description, so the HR signature can't be recorded — re-submit it for sign-off first.",
    );
  }
  if (slot === "HR" && ctx.jdAuthorId === actor.id) {
    return no(
      "You drafted this job description, so you can't also give it the independent HR sign-off (separation of duties).",
    );
  }
  return OK;
}

export function canRequestJdChanges(actor: JdActor, ctx: JdContext): Result {
  if (!hasStanding(actor, ctx)) return no("You don't have permission to review a job description.");
  if (ctx.jdStatus !== "AWAITING_SIGNOFF") {
    return no("This job description isn't up for sign-off, so there's nothing to send back.");
  }
  const eligible = JD_SLOTS.some((s) => slotEligibility(actor, s, ctx.hiringManagerId).ok);
  return eligible
    ? OK
    : no("Only the hiring manager or HR can send a job description back for changes.");
}

export function canSubmitJd(actor: JdActor, ctx: JdContext): Result {
  if (!hasStanding(actor, ctx)) return no("You don't have permission to submit a job description.");
  if (ctx.jdStatus === "AWAITING_SIGNOFF")
    return no("This job description is already awaiting sign-off.");
  if (ctx.jdStatus === "APPROVED") {
    return no("This job description is already signed off — revise it to start a new round.");
  }
  if (!ctx.description?.trim()) {
    return no("There's nothing to sign off yet — write the job description before submitting it.");
  }
  return OK;
}

/** The slot(s) this actor could sign now (drives "Approve JD" on the screen). */
export function signableSlots(actor: JdActor, ctx: JdContext): HiringJdSignatory[] {
  return JD_SLOTS.filter((s) => canSignJd(actor, s, ctx).ok);
}
