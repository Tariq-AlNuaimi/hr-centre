import { auditedTransaction, prisma } from "@/lib/prisma";
import { canOnPair, hasHivePermission } from "./permissions";
import { revokeReplyTokens } from "@/lib/hive/reply-token";
import { notifyTicket } from "./ticket-notify";
import { recordEvent, transition } from "./escalation-transition";
import type { EscalationStatus } from "@/generated/prisma/enums";

// The read and send halves live in their own modules (size); re-exported so
// every caller keeps importing the queue service.
export {
  QUEUE_SELECT,
  getEscalation,
  listEscalations,
  listQueuePairs,
  queueWhere,
  type QueueFilter,
} from "./escalation-read";
import { resolveUserNotices } from "@/lib/core/notify/user-notify";
export { approveAndSend, renderTemplate, type ApproveOutcome } from "./escalation-send";

/**
 * §5.4's queue, draft, approval and send (US10, US11).
 *
 * The one rule this file exists to enforce is §5.4 step 5, and the spec leaves
 * no room in it:
 *
 *   "The HR Manager (Muna) reviews and approves — required for every single
 *    answer, no exceptions, regardless of who drafted it."
 *
 * So there is exactly ONE path from a draft to a sent email, it runs through
 * {@link approveAndSend}, and that function refuses without the `approve` permission (ADMIN only, ADR-072). There
 * is no force flag, no admin override, and no second way in — AC-11.1 says "no
 * exception path", and an exception path is precisely the kind of thing that
 * gets added later for a good reason and used routinely after that.
 *
 * Spec V2 (docs/blueprints/hive-ticketing.md, phase T1) turns the escalation
 * into a tracked ticket with an explicit lifecycle:
 *
 *   OPEN → IN_PROGRESS (draft saved) → PENDING_APPROVAL (submitted)
 *        → APPROVED (transient: sending) → SENT → CLOSED
 *
 * with SEND_FAILED as a resumable side state and a return path from
 * PENDING_APPROVAL back to IN_PROGRESS. Every transition is ONE conditional
 * update ({@link transition}: `update` filtered on the expected status) plus an
 * `EscalationEvent` written in the same transaction, so two people acting at
 * once cannot both win (blueprint W4) and the history can never disagree with
 * the ticket.
 *
 * Who approves is still the permission check (ADR-072 today; pair-scoped grants
 * arrive in phase T2 with ADR-073). There is deliberately no coverage check here
 * yet — adding one is T2's job, not a side effect of T1.
 *
 * @public
 */

/**
 * Pair-scoped gate (ADR-073): may this person do `action` on THIS ticket?
 *
 * Holding the permission somewhere is checked first, before the ticket is
 * read, so asking about an id you could never act on does not reveal whether
 * it exists. Then the ticket's own pair decides.
 */
async function pairGate(
  id: string,
  userId: string,
  action: "draftEscalation" | "approve",
): Promise<"forbidden" | "not_found" | null> {
  if (!(await hasHivePermission(userId, action))) return "forbidden";
  const row = await prisma.escalation.findUnique({ where: { id }, select: { hrPairId: true } });
  if (!row) return "not_found";
  return (await canOnPair(userId, action, row.hrPairId)) ? null : "forbidden";
}

/**
 * What the signed-in person may do on one ticket — for the detail screen, so
 * it shows only buttons the server will honour (blueprint AC-T3.2/AC-T3.3).
 * Chrome, not a control: every action re-checks in its own service function.
 *
 * @public
 */
export async function ticketAbilities(
  userId: string,
  ticket: { hrPairId: string; draftedById: string | null },
): Promise<{ draft: boolean; approve: boolean; ownDraft: boolean }> {
  const [draft, approve] = await Promise.all([
    canOnPair(userId, "draftEscalation", ticket.hrPairId),
    canOnPair(userId, "approve", ticket.hrPairId),
  ]);
  return { draft, approve, ownDraft: ticket.draftedById === userId };
}

/** Statuses a draft may still be (re)written in. */
const DRAFTABLE: EscalationStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "SEND_FAILED"];

export type DraftOutcome =
  | { ok: true; status: "IN_PROGRESS" }
  | { error: "not_found" | "forbidden" | "already_sent" | "closed" | "sending" };

/**
 * Save a draft answer. Anyone whose Draft scope covers the ticket's pair may.
 *
 * Saving moves the ticket to IN_PROGRESS — from OPEN on the first draft, and
 * BACK from PENDING_APPROVAL or SEND_FAILED when the text changes. That is the
 * point: approval (or a pending submission) is for a specific text, and an
 * answer edited after it is a different answer (AC-11.1), so the submission and
 * any approval are cleared and it must be submitted again.
 */
export async function draftAnswer(
  id: string,
  answer: string,
  userId: string,
): Promise<DraftOutcome> {
  const refused = await pairGate(id, userId, "draftEscalation");
  if (refused) return { error: refused };
  return auditedTransaction(async (tx) => {
    const updated = await transition(
      tx,
      { id, status: { in: DRAFTABLE } },
      {
        draftAnswer: answer,
        draftedById: userId,
        status: "IN_PROGRESS",
        submittedById: null,
        submittedAt: null,
        approvedById: null,
        approvedAt: null,
        sendError: null,
      },
    );
    if (!updated) {
      const row = await tx.escalation.findUnique({ where: { id }, select: { status: true } });
      if (!row) return { error: "not_found" as const };
      // A sent answer is a thing an employee has already read; editing the record
      // afterwards would make the trail describe an email nobody received.
      if (row.status === "SENT") return { error: "already_sent" as const };
      // CLOSED revoked the reply links (ADR-070 clause 4): writing into a thread
      // the employee has been shut out of is a one-way message dressed as one.
      if (row.status === "CLOSED") return { error: "closed" as const };
      return { error: "sending" as const };
    }
    await recordEvent(tx, id, "DRAFT_SAVED", userId);
    return { ok: true as const, status: "IN_PROGRESS" as const };
  });
}

export type SubmitOutcome =
  | { ok: true; status: "PENDING_APPROVAL" }
  | { error: "not_found" | "forbidden" | "no_draft" | "not_in_progress" | "unchanged" };

/**
 * Submit the current draft for approval (spec V2 §5.4 step 5, "Submit for
 * approval"). IN_PROGRESS with a non-empty draft → PENDING_APPROVAL.
 */
export async function submitForApproval(id: string, userId: string): Promise<SubmitOutcome> {
  const refused = await pairGate(id, userId, "draftEscalation");
  if (refused) return { error: refused };
  // A ticket reopened by an employee's follow-up still holds the answer that
  // was already sent. Submitting it unedited would mail the employee the same
  // email again, so the draft must differ from the last thing HR sent.
  const [current, lastSent] = await Promise.all([
    prisma.escalation.findUnique({ where: { id }, select: { draftAnswer: true } }),
    prisma.escalationMessage.findFirst({
      where: { escalationId: id, direction: "OUTBOUND" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { body: true },
    }),
  ]);
  if (current?.draftAnswer && lastSent && current.draftAnswer.trim() === lastSent.body.trim()) {
    return { error: "unchanged" };
  }
  const outcome = await auditedTransaction(async (tx) => {
    const updated = await transition(
      tx,
      { id, status: "IN_PROGRESS", draftAnswer: { not: null } },
      { status: "PENDING_APPROVAL", submittedById: userId, submittedAt: new Date() },
    );
    if (!updated) {
      const row = await tx.escalation.findUnique({
        where: { id },
        select: { status: true, draftAnswer: true },
      });
      if (!row) return { error: "not_found" as const };
      if (!row.draftAnswer?.trim()) return { error: "no_draft" as const };
      return { error: "not_in_progress" as const };
    }
    await recordEvent(tx, id, "SUBMITTED", userId);
    return { ok: true as const, status: "PENDING_APPROVAL" as const };
  });
  // US-T5: approvers covering the pair (minus the drafter) learn it waits.
  if ("ok" in outcome) notifyTicket("submitted", id);
  return outcome;
}

export type ReturnOutcome =
  { ok: true; status: "IN_PROGRESS" } | { error: "not_found" | "forbidden" | "not_pending" };

/**
 * An approver sends a submitted draft back with a note (blueprint AC-T2.2).
 * PENDING_APPROVAL → IN_PROGRESS; the draft text is kept for the drafter to edit.
 */
export async function returnToDraft(
  id: string,
  userId: string,
  note?: string,
): Promise<ReturnOutcome> {
  const refused = await pairGate(id, userId, "approve");
  if (refused) return { error: refused };
  const outcome = await auditedTransaction(async (tx) => {
    const updated = await transition(
      tx,
      { id, status: "PENDING_APPROVAL" },
      { status: "IN_PROGRESS", submittedById: null, submittedAt: null },
    );
    if (!updated) {
      const row = await tx.escalation.findUnique({ where: { id }, select: { id: true } });
      return { error: row ? ("not_pending" as const) : ("not_found" as const) };
    }
    await recordEvent(tx, id, "RETURNED", userId, note);
    return { ok: true as const, status: "IN_PROGRESS" as const };
  });
  // UX review P0 (US-6): the drafter hears it in the bell.
  if ("ok" in outcome) {
    notifyTicket("returned", id);
    // QA2 N-15 — a return decides the approval as surely as an approve does.
    await resolveUserNotices(`tickets:submitted:${id}:`);
  }
  return outcome;
}

export type CloseOutcome =
  | { ok: true; revoked: number }
  | { error: "not_found" | "forbidden" | "already_closed" | "sending" };

/**
 * Close a ticket, and take its reply links with it (ADR-070 clause 4).
 *
 * Spec V2 §8.8: "Anyone who can draft sees Close ticket on a Sent ticket." So a
 * drafter may close a SENT ticket; closing anything else (e.g. a duplicate that
 * was never answered) stays an approver's decision.
 */
export async function closeEscalation(id: string, userId: string): Promise<CloseOutcome> {
  const [holdsApprove, holdsDraft] = await Promise.all([
    hasHivePermission(userId, "approve"),
    hasHivePermission(userId, "draftEscalation"),
  ]);
  if (!holdsApprove && !holdsDraft) return { error: "forbidden" };

  const row = await prisma.escalation.findUnique({
    where: { id },
    select: { status: true, hrPairId: true },
  });
  if (!row) return { error: "not_found" };
  // ADR-073: scoped to the ticket's pair, like every other action.
  const [canApprove, canDraft] = await Promise.all([
    canOnPair(userId, "approve", row.hrPairId),
    canOnPair(userId, "draftEscalation", row.hrPairId),
  ]);
  if (!canApprove && !canDraft) return { error: "forbidden" };
  if (row.status === "CLOSED") return { error: "already_closed" };
  // Not mid-send: the in-flight send would mint a reply link AFTER the close
  // revoked them, leaving a live link on a closed thread. Close once it settles.
  if (row.status === "APPROVED") return { error: "sending" };
  if (!canApprove && row.status !== "SENT") return { error: "forbidden" };

  const closed = await auditedTransaction(async (tx) => {
    const done = await transition(tx, { id, status: row.status }, { status: "CLOSED" });
    if (!done) return false;
    await recordEvent(tx, id, "CLOSED", userId);
    return true;
  });
  if (!closed) return { error: "already_closed" };
  // After the status, not before: if this throws, the links expire on their own
  // within 30 days; the other order would revoke links on a thread still open.
  const revoked = await revokeReplyTokens(id);
  return { ok: true, revoked };
}
