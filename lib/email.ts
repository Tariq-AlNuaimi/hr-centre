// Email sending helper using nodemailer.
//
// Gated by SMTP_HOST being set. If unset, sendEmail() logs a warning and returns
// `{ sent: false }` without throwing -- the template ships email-disabled so a
// fresh fork doesn't need SMTP configured before first deploy. Forks enable
// email during /first-fork by setting SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASSWORD, SMTP_FROM as Vercel project env vars.
//
// Security (SECURITY.md §1 + §6):
//   - SMTP_PASSWORD is Restricted -- never logged, never returned by any API.
//   - Email bodies may carry one-time secrets (OTP, reset tokens, presigned URLs).
//     This module logs only metadata (to summary, subject, messageId) -- never the
//     full body. Callers that pass Restricted content in `text`/`html` MUST NOT
//     forward those values to console / Sentry / structured loggers separately.
//   - For mass sends, prefer `to: string[]` over comma-joining manually -- the
//     log line summarizes as "N recipients" rather than dumping the full list.

import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";

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
  /** False if SMTP_HOST is unset (email disabled). The caller decides whether that's a fatal error. */
  sent: boolean;
  /** Provider-assigned message id, present only when sent=true. */
  messageId?: string;
}

export function isEmailEnabled(): boolean {
  return !!process.env.SMTP_HOST;
}

/**
 * Build a nodemailer SendMailOptions object from our higher-level shape.
 * Exported separately so the contract suite can verify message construction
 * without spinning up a real SMTP transport.
 */
export function buildMailOptions(opts: SendEmailOptions): SendMailOptions {
  return {
    from: opts.from ?? process.env.SMTP_FROM ?? "noreply@localhost",
    to: Array.isArray(opts.to) ? opts.to.join(",") : opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  };
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const t = getTransporter();
  if (!t) {
    const toLabel = Array.isArray(opts.to) ? `${opts.to.length} recipients` : opts.to;
    console.warn(`[email] SMTP_HOST not set; skipping send to=${toLabel} subject="${opts.subject}"`);
    return { sent: false };
  }

  const info = await t.sendMail(buildMailOptions(opts));

  // Metadata-only log line. Never the body.
  const toLabel = Array.isArray(opts.to) ? `${opts.to.length} recipients` : opts.to;
  console.log(`[email] sent messageId=${info.messageId} to=${toLabel} subject="${opts.subject}"`);

  return { sent: true, messageId: info.messageId };
}
