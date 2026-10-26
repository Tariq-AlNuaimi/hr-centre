import { prisma } from "@/lib/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import { isWithinWindow, nextWindowOpening } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { JmlError } from "../errors";
import { contextForCase, missingVariables, render, type TemplateContext } from "./templates";
import { resolveTemplate, resolveTemplates, type ResolvedTemplate } from "./overrides";

/**
 * The joiner email queue — HR Onboarding `mail-queue.ts` (§11, BR-015,
 * AC-NOT-001, AC-7.4), ported. Everything is QUEUED (a `JmlEmailLog` row with no
 * body, ever — §11.3), scheduled for the next working-window opening of the ONE
 * calendar (now holiday-aware), re-checked at drain time, and rendered at send.
 * SMTP off ⇒ rows stay queued (not failures). A failed send is FAILED with its
 * reason; a retry is a NEW row linked to the original.
 */

export type QueueEmailInput = {
  type: string;
  recipient: string;
  cc?: string;
  /** Fallback subject; the (possibly overridden) template subject wins when renderable. */
  subject: string;
  caseId?: string;
  notBefore?: Date;
};

export async function queueEmail(input: QueueEmailInput) {
  const calendar = await loadWorkingCalendar();
  const scheduledFor = nextWindowOpening(input.notBefore ?? new Date(), calendar);
  const { subject, cc } = await resolveHeaders(input);
  return prisma.jmlEmailLog.create({
    data: {
      type: input.type,
      recipient: input.recipient,
      cc: cc ?? null,
      subject,
      status: "QUEUED",
      scheduledFor,
      ...(input.caseId ? { caseId: input.caseId } : {}),
    },
    select: { id: true, type: true, scheduledFor: true, status: true },
  });
}

async function resolveHeaders(
  input: QueueEmailInput,
): Promise<{ subject: string; cc: string | undefined }> {
  const template = await resolveTemplate(input.type);
  if (!template) return { subject: input.subject, cc: input.cc };
  const existing = (input.cc ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const merged = [...new Set([...existing, ...template.ccRecipients.filter(Boolean)])];
  const context = input.caseId ? await contextForCase(input.caseId) : null;
  const usable = context !== null && missingVariables(template.subject, context).length === 0;
  return {
    subject: usable ? render(template.subject, context) : input.subject,
    cc: merged.length > 0 ? merged.join(", ") : undefined,
  };
}

const BATCH = 25;

/** What the drain may send now: queued, due, and not on a cancelled case. */
export function sendableNow(now: Date) {
  return prisma.jmlEmailLog.findMany({
    where: {
      status: "QUEUED",
      scheduledFor: { lte: now },
      OR: [{ caseId: null }, { case: { status: { not: "CANCELLED" } } }],
    },
    orderBy: { scheduledFor: "asc" },
    select: { id: true, type: true, recipient: true, cc: true, subject: true, caseId: true },
    take: BATCH,
  });
}

export type DrainResult = {
  attempted: number;
  sent: number;
  failed: number;
  skipped: "outside-window" | "email-disabled" | null;
};

export async function drainQueue(now = new Date()): Promise<DrainResult> {
  const calendar = await loadWorkingCalendar(now);
  if (!isWithinWindow(now, calendar)) {
    return { attempted: 0, sent: 0, failed: 0, skipped: "outside-window" };
  }
  if (!isEmailEnabled()) return { attempted: 0, sent: 0, failed: 0, skipped: "email-disabled" };
  const due = await sendableNow(now);
  const templates = new Map((await resolveTemplates()).map((t) => [t.type, t]));
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const body = await renderBody(row.type, row.caseId, templates.get(row.type));
      const cc = row.cc
        ? row.cc
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        : [];
      const result = await sendEmail({
        to: row.recipient,
        ...(cc.length ? { cc } : {}),
        subject: row.subject,
        text: body.text,
        html: body.html,
      });
      if (!result.sent) continue;
      await prisma.jmlEmailLog.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: new Date(), failureReason: null },
        select: { id: true },
      });
      sent += 1;
    } catch (error) {
      await prisma.jmlEmailLog.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          failureReason: String(error instanceof Error ? error.message : error).slice(0, 500),
        },
        select: { id: true },
      });
      failed += 1;
    }
  }
  return { attempted: due.length, sent, failed, skipped: null };
}

/** AC-7.4 — a retry is a NEW row linked to the original, never a mutation of it. */
export async function retryEmail(emailId: string, actorUserId: string) {
  const original = await prisma.jmlEmailLog.findUnique({
    where: { id: emailId },
    select: {
      id: true,
      type: true,
      recipient: true,
      cc: true,
      subject: true,
      caseId: true,
      status: true,
    },
  });
  if (!original) throw new JmlError("Email not found", 404);
  if (original.status === "SENT") throw new JmlError("That message was already sent.");
  const calendar = await loadWorkingCalendar();
  return prisma.jmlEmailLog.create({
    data: {
      type: original.type,
      recipient: original.recipient,
      cc: original.cc,
      subject: original.subject,
      status: "QUEUED",
      scheduledFor: nextWindowOpening(new Date(), calendar),
      resendOfId: original.id,
      sentById: actorUserId,
      ...(original.caseId ? { caseId: original.caseId } : {}),
    },
    select: { id: true, scheduledFor: true, resendOfId: true },
  });
}

const NO_CONTEXT: TemplateContext = {
  fullName: "",
  firstName: "",
  caseNumber: "",
  jobTitle: "",
  companyName: "",
  startDate: "",
  hrOwnerName: "",
};

export async function renderBody(
  type: string,
  caseId: string | null,
  resolved?: ResolvedTemplate,
): Promise<{ text: string; html: string }> {
  const template = resolved ?? (await resolveTemplate(type));
  const context = caseId ? await contextForCase(caseId) : NO_CONTEXT;
  if (template && context) {
    const missing = missingVariables(template.body, context);
    if (missing.length > 0) {
      throw new Error(
        `Template "${type}" needs ${missing.join(", ")}, which this case does not supply`,
      );
    }
    const text = render(template.body, context);
    return { text, html: htmlFromText(text) };
  }
  const kase = caseId
    ? await prisma.jmlCase.findUnique({
        where: { id: caseId },
        select: { caseRef: true, employee: { select: { name: true } } },
      })
    : null;
  const who = kase ? `${kase.employee.name} (${kase.caseRef})` : "an onboarding";
  const text = `Automated onboarding notice: ${type} regarding ${who}.`;
  return { text, html: htmlFromText(text) };
}

function htmlFromText(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space: pre-wrap">${escaped}</div>`;
}

/** Cancel every queued message of a case (BR-017) — per row, audited. */
export async function cancelQueuedEmails(
  tx: Pick<typeof prisma, "jmlEmailLog">,
  caseId: string,
  reason: string,
): Promise<number> {
  const queued = await tx.jmlEmailLog.findMany({
    where: { caseId, status: "QUEUED" },
    select: { id: true },
    take: 500,
  });
  for (const row of queued) {
    await tx.jmlEmailLog.update({
      where: { id: row.id },
      data: { status: "CANCELLED", failureReason: reason },
      select: { id: true },
    });
  }
  return queued.length;
}
