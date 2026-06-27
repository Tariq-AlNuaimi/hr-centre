// Email sending helper. Supports two transports behind one `sendEmail` seam:
//
//   1. Resend  — preferred when RESEND_API_KEY is set (operator's testing
//      transport until the project ships to IT).
//   2. SMTP    — nodemailer, used when SMTP_HOST is set and Resend is not.
//   3. none    — neither configured: sendEmail() logs a warning and returns
//      `{ sent: false }` without throwing, so a fresh fork runs email-disabled.
//
// Callers (e.g. the invitation send path) call `sendEmail` and never pick a
// transport themselves. Transport selection is `selectTransport()` so the
// contract suite can assert the precedence without real network calls.
//
// Security (SECURITY.md §1 + §6):
//   - SMTP_PASSWORD and RESEND_API_KEY are Restricted -- never logged, never
//     returned by any API.
//   - Email bodies may carry one-time secrets (OTP, reset tokens, invitation
//     links). This module logs only metadata (recipient COUNT, subject,
//     messageId) -- never the full body, never a recipient address. Callers that
//     pass Restricted content in `text`/`html` MUST NOT forward those values to
//     console / Sentry / structured loggers separately.
//   - Recipient addresses are Confidential: the log line summarizes every send
//     as "N recipients" (via recipientLabel) and never prints an address.

import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";
import { Resend } from "resend";

export type EmailTransport = "resend" | "smtp" | "none";

/**
 * Which transport `sendEmail` will use, given the current env. Resend wins when
 * its key is present (even if SMTP is also configured); SMTP is the fallback;
 * "none" means email is disabled (no-op send). Pure function of env so it's
 * unit-testable.
 */
export function selectTransport(): EmailTransport {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  return "none";
}

export function isEmailEnabled(): boolean {
  return selectTransport() !== "none";
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (cachedTransporter) return cachedTransporter;

  const port = Number(process.env.SMTP_PORT ?? "587");
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS for port 465; STARTTLS for 587
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });
  return cachedTransporter;
}

let cachedResend: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (cachedResend) return cachedResend;
  cachedResend = new Resend(key);
  return cachedResend;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  /** Plain-text body. Required -- spam filters penalize HTML-only mail. */
  text: string;
  /** Optional HTML alternate. */
  html?: string;
  /** Override the default From address (`SMTP_FROM`). */
  from?: string;
}

export interface SendEmailResult {
  /** False if no transport is configured (email disabled). The caller decides whether that's a fatal error. */
  sent: boolean;
  /** Provider-assigned message id, present only when sent=true. */
  messageId?: string;
}

// Recipient addresses are Confidential (SECURITY.md §1) -- never log them
// verbatim, not even a single `to`. Summarize as a count so the log line stays
// useful (did we attempt a send, to how many?) without leaking who.
export function recipientLabel(to: string | string[]): string {
  const n = Array.isArray(to) ? to.length : 1;
  return `${n} recipient${n === 1 ? "" : "s"}`;
}

/** The From address, shared by both transports. */
function fromAddress(opts: SendEmailOptions): string {
  return opts.from ?? process.env.SMTP_FROM ?? "noreply@localhost";
}

/**
 * Build a nodemailer SendMailOptions object from our higher-level shape.
 * Exported separately so the contract suite can verify message construction
 * without spinning up a real SMTP transport.
 */
export function buildMailOptions(opts: SendEmailOptions): SendMailOptions {
  return {
    from: fromAddress(opts),
    to: Array.isArray(opts.to) ? opts.to.join(",") : opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  };
}

async function sendViaResend(opts: SendEmailOptions): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) return { sent: false };

  const { data, error } = await resend.emails.send({
    from: fromAddress(opts),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    // resend's typed payload requires html | text | react; text alone is fine,
    // html is added only when present.
    ...(opts.html ? { html: opts.html } : {}),
  });

  if (error) {
    // Log the error TYPE only -- error.message can echo a recipient address or
    // payload field, which would leak Confidential data into the logs.
    console.warn(`[email] resend send failed type=${error.name} to=${recipientLabel(opts.to)} subject="${opts.subject}"`);
    throw new Error("Resend send failed");
  }

  console.log(`[email] sent via=resend messageId=${data?.id} to=${recipientLabel(opts.to)} subject="${opts.subject}"`);
  return { sent: true, messageId: data?.id };
}

async function sendViaSmtp(opts: SendEmailOptions): Promise<SendEmailResult> {
  const t = getTransporter();
  if (!t) return { sent: false };

  const info = await t.sendMail(buildMailOptions(opts));

  // Metadata-only log line. Never the body, never the raw recipient address.
  console.log(`[email] sent via=smtp messageId=${info.messageId} to=${recipientLabel(opts.to)} subject="${opts.subject}"`);
  return { sent: true, messageId: info.messageId };
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  switch (selectTransport()) {
    case "resend":
      return sendViaResend(opts);
    case "smtp":
      return sendViaSmtp(opts);
    default:
      console.warn(`[email] no transport configured; skipping send to=${recipientLabel(opts.to)} subject="${opts.subject}"`);
      return { sent: false };
  }
}
