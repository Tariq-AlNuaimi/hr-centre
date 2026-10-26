import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { transition } from "./escalation-transition";
import { notifyTicket } from "./ticket-notify";

/**
 * ADR-070's thread, read and appended through a reply link (AC-9.5…AC-9.7).
 *
 * Every function here takes an escalation id that came from a resolved TOKEN,
 * never from a request. That is ADR-070 clause 1 made structural: there is no
 * parameter on this surface a caller could point at a different escalation.
 *
 * @public
 */

/**
 * What a reply link may show.
 *
 * The employee already knows their own name, their own question, and — from the
 * email that carried this link — the answer, so none of that is a new
 * disclosure. What is deliberately NOT here is anything the link does not need:
 * no `sessionId` (§3.7 keeps the conversation on the device and out of this
 * view), no `employeeEmail` echoed back, no drafter, no approver.
 */
const THREAD_SELECT = {
  id: true,
  status: true,
  employeeName: true,
  question: true,
  draftAnswer: true,
  createdAt: true,
  hrPair: { select: { name: true } },
  messages: {
    // `id` after `at`, because `at` is not unique: two messages written in the
    // same millisecond would otherwise render in an arbitrary order, and a
    // question shown after its answer reads as a different conversation.
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { id: true, direction: true, body: true, at: true },
    // Bounded: a thread is a handful of turns, and an unbounded relation read on
    // a public route is how one becomes a payload.
    take: 100,
  },
  // `satisfies` rather than `as const`: the latter freezes the nested `orderBy`
  // into a readonly tuple, which Prisma's `Exact` type rejects. This keeps the
  // literal checked against the real select shape, so a typo is still an error.
} satisfies Prisma.EscalationSelect;

export interface ReplyThread {
  id: string;
  employeeName: string;
  question: string;
  answer: string | null;
  hrPairName: string;
  closed: boolean;
  createdAt: Date;
  messages: { id: string; direction: string; body: string; at: Date }[];
}

/** The one escalation a token grants, shaped for the employee's own screen. */
export async function loadReplyThread(escalationId: string): Promise<ReplyThread | null> {
  const row = await prisma.escalation.findUnique({
    where: { id: escalationId },
    select: THREAD_SELECT,
  });
  if (!row) return null;
  return {
    id: row.id,
    employeeName: row.employeeName,
    question: row.question,
    // Only once it has actually been sent. An unsent (in-progress or pending)
    // answer is HR's working text, not something anyone has been told —
    // surfacing it here would let a
    // link leak an answer before it was approved, which is the one thing §5.4's
    // approval gate exists to prevent.
    answer: row.status === "SENT" ? row.draftAnswer : null,
    hrPairName: row.hrPair.name,
    closed: row.status === "CLOSED",
    createdAt: row.createdAt,
    messages: row.messages,
  };
}

/** Follow-ups one thread may hold. Bounded per thread, not just per minute. */
const MAX_FOLLOWUPS = 5;

export type ReplyOutcome =
  { ok: true; status: string } | { error: "not_found" | "closed" | "too_many" };

/**
 * AC-9.5 — append a follow-up to the SAME escalation, routed to the same HR pair.
 *
 * "SHALL NOT create a new escalation" is satisfied structurally: there is no
 * `escalation.create` in this file, and the routing is unchanged because
 * `hrPairId` is never written.
 *
 * ADR-070's Mitigations are the rest of it: "the write path from a reply link
 * appends an `EscalationMessage` and nothing else — it cannot alter the original
 * question, the approved answer, or any status" beyond putting the thread back
 * in front of HR. `question`, `draftAnswer`, `employeeName`, `employeeEmail`,
 * `approvedById` and `hrPairId` are absent from the update below, and that
 * absence is the control.
 */
export async function appendReply(escalationId: string, body: string): Promise<ReplyOutcome> {
  const row = await prisma.escalation.findUnique({
    where: { id: escalationId },
    select: { id: true, status: true },
  });
  if (!row) return { error: "not_found" };
  // A closed thread stays closed. HR decided it was finished, and a link that
  // could reopen it indefinitely would make CLOSED mean nothing.
  if (row.status === "CLOSED") return { error: "closed" };

  // The rate limit stops a flood; this stops a slow one. Without it a link is an
  // unbounded write into a Confidential record HR are obliged to read.
  const existing = await prisma.escalationMessage.count({
    where: { escalationId, direction: "INBOUND" },
  });
  if (existing >= MAX_FOLLOWUPS) return { error: "too_many" };

  await prisma.escalationMessage.create({
    data: { escalationId, direction: "INBOUND", body },
  });

  // Back into the queue as work in progress for the same pair (spec V2 §8.8: "A
  // follow-up reply from the employee reopens the same ticket thread and puts it
  // back to In Progress for the same pair"). A pending submission is cleared —
  // the draft was written before this reply existed. A ticket mid-send
  // (APPROVED) keeps its status: the message is recorded and HR see it once the
  // send settles.
  const reopened = await auditedTransaction(async (tx) => {
    const moved = await transition(
      tx,
      {
        id: escalationId,
        status: { in: ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "SENT", "SEND_FAILED"] },
      },
      { status: "IN_PROGRESS", submittedById: null, submittedAt: null },
    );
    if (!moved) return false;
    await tx.escalationEvent.create({
      data: { escalationId, kind: "REOPENED", actorId: null },
      select: { id: true },
    });
    return true;
  });
  // US-T5: since ADR-075 nobody watches the queue — the pair and the drafter
  // must hear that the employee followed up.
  if (reopened) notifyTicket("reopened", escalationId);

  // Recorded because the actor is a bearer token rather than a person: this row
  // is the only place that fact is written down. No body — the message text is
  // Confidential and already stored once, in the row this refers to.
  await recordAudit(prisma, {
    entityType: "Escalation",
    entityId: escalationId,
    action: "UPDATE",
    after: { followUp: true, via: "reply-link", status: "IN_PROGRESS" },
  });

  return { ok: true, status: "IN_PROGRESS" };
}
