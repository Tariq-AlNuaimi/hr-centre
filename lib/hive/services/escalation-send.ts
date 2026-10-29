import { prisma, auditedTransaction } from "@/lib/prisma";
import { sendLoggedEmail } from "@/lib/core/email/send";
import { canOnPair, hasHivePermission } from "./permissions";
import { issueReplyToken, replyLinkFor } from "@/lib/hive/reply-token";
import { env } from "@/lib/env";
// The answer email's default has one owner (the template service).
import { loadTemplate } from "./email-template";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { notifyTicket } from "./ticket-notify";
import { getTicketSettings } from "./ticket-settings";
import { recordEvent, transition } from "./escalation-transition";
import type { EscalationStatus } from "@/generated/prisma/enums";

/**
 * Approve and send — the only path from a draft to an employee's inbox
 * (HIVE §5.4 steps 5–6; split from escalation-queue.ts for size, behaviour
 * unchanged).
 *
 * @public
 */

/**
 * How long an APPROVED ("sending") claim may stand before another approver can
 * take it over. A send finishes in seconds; a claim older than this means the
 * process died between the claim and the settle (a timeout, a crash), and
 * without recovery the ticket would refuse every action but Close forever.
 * The cost of recovering is a possible duplicate email if the first send did
 * go out and only the settle failed — preferred to an answer that never sends.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export type ApproveOutcome =
  | { ok: true; status: "SENT" }
  | { ok: false; status: "SEND_FAILED"; error: string }
  | {
      error:
        | "not_found"
        | "no_draft"
        | "already_sent"
        | "closed"
        | "forbidden"
        | "not_pending"
        | "sending"
        | "self_approval";
    };

interface TemplateFields {
  employeeName: string;
  question: string;
  answer: string;
  hrPairName: string;
  replyLink: string | null;
  /** Spec V2 §5.7: the ticket ID in the subject, e.g. HIVE-0001. */
  ticketId: string;
}

/**
 * Render §5.6's admin-editable template.
 *
 * §5.6 is emphatic that the wording is content, not code: "must be stored as
 * editable template text in the admin panel… not hardcoded — so Alaa can reword
 * the subject, opening line, or sign-off later without a developer." So this
 * substitutes into whatever is stored and never composes a sentence of its own.
 *
 * A `{{replyLink}}` with no link yet has its whole LINE removed rather than
 * being left as an empty placeholder or a dangling "reply here:". The reply
 * flow (5.3, ADR-070) needs a model that does not exist yet; until it does, the
 * email is simply one line shorter.
 */
export function renderTemplate(
  template: { subject: string; body: string },
  fields: TemplateFields,
): { subject: string; text: string } {
  const fill = (s: string) =>
    s
      .replaceAll("{{employeeName}}", fields.employeeName)
      .replaceAll("{{question}}", fields.question)
      .replaceAll("{{answer}}", fields.answer)
      .replaceAll("{{hrPairName}}", fields.hrPairName)
      .replaceAll("{{ticketId}}", fields.ticketId);

  const lines = fill(template.body)
    .split("\n")
    .filter((line) => fields.replyLink !== null || !line.includes("{{replyLink}}"))
    .map((line) => (fields.replyLink ? line.replaceAll("{{replyLink}}", fields.replyLink) : line));

  return { subject: fill(template.subject), text: lines.join("\n") };
}

/**
 * Approve and send. The only path from a draft to an employee's inbox.
 *
 * AC-11.3 makes the send automatic — "no manual sending by HR… since manual
 * sending recreates the exact burden the escalation design is meant to avoid" —
 * so approval and send are one action rather than two buttons.
 *
 * AC-11.4 is what the ordering below is for: the row is NOT marked `SENT`
 * before the send is known to have worked. A failure lands in `SEND_FAILED`
 * with the error recorded, which puts it back in the queue where a human sees
 * it. The tempting shape — mark SENT, then send — is one crash away from an
 * employee never hearing back while the record says they did.
 */
/**
 * May this ticket be approved (or re-sent) right now — pure, so the rules read
 * as one list. A retry (SEND_FAILED, or a stale-claim takeover) re-sends an
 * approval already given: it keeps the original approver and records no second
 * APPROVED event.
 */
function approvalEligibility(
  row: { status: EscalationStatus; draftAnswer: string | null; updatedAt: Date },
  now: number,
):
  | { retry: boolean }
  | { error: "already_sent" | "closed" | "no_draft" | "sending" | "not_pending" } {
  if (row.status === "SENT") return { error: "already_sent" };
  // CLOSED too (found by the RBAC matrix): approving after HR closed a thread
  // would mail an employee about a conversation whose reply link was revoked.
  if (row.status === "CLOSED") return { error: "closed" };
  // Approving an empty answer would send a blank email over HR's name.
  if (!row.draftAnswer?.trim()) return { error: "no_draft" };
  if (row.status === "APPROVED") {
    return now - row.updatedAt.getTime() > STALE_CLAIM_MS ? { retry: true } : { error: "sending" };
  }
  // Spec V2: only a SUBMITTED draft is approved (PENDING_APPROVAL), or one whose
  // send failed is retried (SEND_FAILED).
  if (row.status === "SEND_FAILED") return { retry: true };
  if (row.status === "PENDING_APPROVAL") return { retry: false };
  return { error: "not_pending" };
}

export async function approveAndSend(id: string, userId: string): Promise<ApproveOutcome> {
  // The gate, checked against the DATABASE rather than a session claim, so a
  // revoked permission takes effect on the next request.
  if (!(await hasHivePermission(userId, "approve"))) return { error: "forbidden" };

  const row = await prisma.escalation.findUnique({
    where: { id },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      employeeName: true,
      employeeEmail: true,
      question: true,
      draftAnswer: true,
      draftedById: true,
      hrPairId: true,
      updatedAt: true,
      firstResponseAt: true,
      hrPair: { select: { name: true } },
    },
  });
  if (!row) return { error: "not_found" };
  // ADR-073: Approve must cover THIS ticket's pair (own pair, a cover grant for
  // it, or all pairs).
  if (!(await canOnPair(userId, "approve", row.hrPairId))) return { error: "forbidden" };
  const eligible = approvalEligibility(row, Date.now());
  if ("error" in eligible) return eligible;
  const { retry } = eligible;
  // Amendment B-3, blueprint AC-T3.3: nobody approves the draft they wrote,
  // whatever their scope. A retry re-sends an approval someone ELSE already
  // gave, so it is not a second approval and is not refused here.
  if (!retry && row.draftedById === userId) return { error: "self_approval" };
  // Non-empty by `approvalEligibility`; bound once so the text claimed, sent and
  // recorded is provably the same string.
  const answer = row.draftAnswer ?? "";

  // CLAIM the ticket before anything is sent: one conditional update, so when two
  // approvers press at once exactly one moves it to APPROVED and sends; the other
  // sees no match (blueprint W4). APPROVED records the human decision, which
  // stands whether or not the transport cooperates — and it is what makes a
  // SEND_FAILED row resumable without a second approval.
  // Taken before the claim: any employee message at or after it arrived while
  // this send was in flight (see the late-reply check after the settle).
  const claimStarted = new Date();
  const claimed = await auditedTransaction(async (tx) => {
    const won = await transition(
      tx,
      // `updatedAt` pins a stale takeover to the claim it observed, so two
      // approvers recovering the same stuck ticket cannot both win.
      { id, status: row.status, draftAnswer: row.draftAnswer, updatedAt: row.updatedAt },
      retry
        ? { status: "APPROVED" }
        : { status: "APPROVED", approvedById: userId, approvedAt: new Date() },
    );
    if (!won) return false;
    if (!retry) await recordEvent(tx, id, "APPROVED", userId);
    return true;
  });
  if (!claimed) {
    const now = await prisma.escalation.findUnique({ where: { id }, select: { status: true } });
    if (now?.status === "SENT") return { error: "already_sent" };
    if (now?.status === "CLOSED") return { error: "closed" };
    return { error: "sending" };
  }

  const [stored, { ticketPrefix }] = await Promise.all([
    loadTemplate("escalation-answer"),
    getTicketSettings(),
  ]);
  // ADR-070: minted BEFORE the send, because the link has to be inside the
  // email. The origin comes from `AUTH_URL`, never a request header (a forwarded
  // Host would poison the link); with none configured the line is dropped.
  const replyLink = env.AUTH_URL ? replyLinkFor(env.AUTH_URL, await issueReplyToken(row.id)) : null;

  const { subject, text } = renderTemplate(stored, {
    employeeName: row.employeeName,
    question: row.question,
    answer,
    hrPairName: row.hrPair.name,
    replyLink,
    ticketId: formatTicketId(row.ticketNumber, ticketPrefix),
  });

  let failure: string | null = null;
  try {
    const result = await sendLoggedEmail(
      { to: row.employeeEmail, subject, text },
      {
        module: "tickets",
        type: "escalation-answer",
        subjectType: "tickets.escalation",
        subjectId: id,
        sentById: userId,
      },
    );
    // `sent: false` is the unconfigured case — a FAILURE here: the employee is
    // waiting on an email that was never written to a socket.
    if (!result.sent) failure = "Email is not configured (SMTP_HOST is unset).";
  } catch (error) {
    // Kept for HR's eyes but truncated: a transport error can carry the whole
    // message body, which contains the employee's question (Confidential, §1).
    failure = String(error instanceof Error ? error.message : error).slice(0, 300);
  }

  // Both settle writes are conditional on the claim this call holds. Close
  // refuses a ticket mid-send, but a stale-claim takeover can still overtake a
  // slow send; the loser must not overwrite what the winner recorded.
  if (failure) {
    await auditedTransaction(async (tx) => {
      if (
        await transition(
          tx,
          { id, status: "APPROVED" },
          { status: "SEND_FAILED", sendError: failure },
        )
      ) {
        await recordEvent(tx, id, "SEND_FAILED", userId, failure ?? undefined);
      }
    });
    return { ok: false, status: "SEND_FAILED", error: failure };
  }

  // SENT only after the send is known to have worked (AC-11.4).
  const settledAs = await auditedTransaction(async (tx) => {
    const settled = await transition(
      tx,
      { id, status: "APPROVED" },
      {
        status: "SENT",
        sentAt: new Date(),
        sendError: null,
        // UX P1 (tickets P1-2): the first answer's time, for response reporting.
        ...(row.firstResponseAt ? {} : { firstResponseAt: new Date() }),
      },
    );
    // The outbound message is part of the thread, so a later reply (ADR-070)
    // appends to a conversation rather than starting one. Recorded even if the
    // settle lost: the email DID go out, and the thread must say so.
    await tx.escalationMessage.create({
      data: { escalationId: id, direction: "OUTBOUND", body: answer },
    });
    if (!settled) return "lost" as const;
    await recordEvent(tx, id, "SENT", userId);
    // An employee reply that arrived WHILE this was sending could not reopen the
    // ticket (`reply.ts` leaves a sending ticket alone). Reopen it now, or the
    // follow-up sits unread behind a SENT status nobody works.
    const lateReply = await tx.escalationMessage.findFirst({
      where: { escalationId: id, direction: "INBOUND", at: { gte: claimStarted } },
      select: { id: true },
    });
    if (lateReply) {
      await transition(
        tx,
        { id, status: "SENT" },
        { status: "IN_PROGRESS", submittedById: null, submittedAt: null },
      );
      await recordEvent(tx, id, "REOPENED", null);
      return "reopened" as const;
    }
    return "sent" as const;
  });
  // US-T5, only for the call that actually settled the ticket: a stale-claim
  // takeover that lost must not mail the drafter twice, and a ticket a late
  // reply just reopened is news for the pair, not a "sent" note.
  if (settledAs === "sent") notifyTicket("sent", id);
  if (settledAs === "reopened") notifyTicket("reopened", id);
  return { ok: true, status: "SENT" };
}
