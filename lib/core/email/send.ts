import { prisma } from "@/lib/prisma";
import { sendEmail, type SendEmailOptions, type SendEmailResult } from "@/lib/email";

/**
 * The one way a module sends an email it wants on record (ADR-095): the single
 * transport (`lib/email.ts`) plus a row in the core email log. The row holds
 * metadata only — module, type, recipient (Confidential), subject, outcome —
 * never the body. JML's outbound queue writes the same log through its queue.
 *
 * Behaviour is the transport's: `sent: false` when SMTP is not configured, and
 * a transport error is re-thrown after it is logged. A log write that fails
 * never turns a sent email into an error.
 */

export type EmailMeta = {
  module: "tickets" | "performance" | "hiring";
  /** The module's message type ("escalation-answer", "cycle-reminder", …). */
  type: string;
  subjectType?: string | null;
  subjectId?: string | null;
  sentById?: string | null;
};

const MAX_REASON = 300;

export async function sendLoggedEmail(
  opts: SendEmailOptions,
  meta: EmailMeta,
): Promise<SendEmailResult> {
  let result: SendEmailResult | null = null;
  let failure: string | null = null;
  try {
    result = await sendEmail(opts);
    if (!result.sent) failure = "Email is not configured (SMTP_HOST is unset).";
    return result;
  } catch (error) {
    failure = String(error instanceof Error ? error.message : error).slice(0, MAX_REASON);
    throw error;
  } finally {
    await logSend(opts, meta, failure).catch(() => {
      // Not detailed: the error could carry an address.
      console.warn(`[email] a ${meta.module} send could not be logged`);
    });
  }
}

async function logSend(opts: SendEmailOptions, meta: EmailMeta, failure: string | null) {
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : v);
  const now = new Date();
  await prisma.emailLog.create({
    data: {
      module: meta.module,
      type: meta.type.slice(0, 80),
      recipient: list(opts.to) ?? "",
      cc: list(opts.cc) || null,
      subject: opts.subject.slice(0, 300),
      status: failure ? "FAILED" : "SENT",
      scheduledFor: now,
      sentAt: failure ? null : now,
      failureReason: failure,
      subjectType: meta.subjectType ?? null,
      subjectId: meta.subjectId ?? null,
      sentById: meta.sentById ?? null,
    },
    select: { id: true },
  });
}
