import { NextRequest, after } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prismaUnfiltered } from "@/lib/prisma";
import { ok, err } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

// PUBLIC route (middleware allows /api/auth/*). Initiates a password reset.
// Always returns 200 with the same body whether or not the email exists, so it
// cannot be used to enumerate accounts. Token is stored in VerificationToken
// (identifier = email) and expires in 1 hour.
//
// Anti-enumeration is BOTH body- and timing-safe: the account lookup + token
// create + email send run in next/server's after() (i.e. AFTER the response is
// flushed), so the handler returns the neutral 200 in constant time whether or
// not the account exists. after() runs the work post-response on Vercel, so no
// timing oracle remains. (A reset email is inherently async anyway.)

const schema = z.object({ email: z.string().email() });
const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<Response> {
  const limit = await rateLimit(req, { id: "auth-reset", limit: 5, windowMs: 60_000 });
  if (!limit.ok) {
    return err("Too many requests", 429);
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  // Neutral response regardless of validity (no enumeration / no error oracle).
  const neutral = ok({ message: "If that email exists, a reset link was sent." });
  if (!parsed.success) return neutral;

  const email = parsed.data.email.toLowerCase();
  // Build the reset link from a server-configured base URL, NOT the request's
  // Host header. Trusting req.nextUrl.origin lets a forwarded/attacker Host
  // poison the emailed link and leak the token (reset poisoning). AUTH_URL is
  // injected automatically on Vercel; fall back to the request origin only when
  // unconfigured (e.g. local dev), which is the lower-risk environment.
  const origin = env.AUTH_URL ?? req.nextUrl.origin;

  // Do the existence-dependent work AFTER the response flushes, so the response
  // time is identical whether or not the account exists (closes the enumeration
  // timing oracle). The neutral 200 has already been sent, so a failure here
  // (DB or SMTP) must be swallowed -- an uncaught rejection in after() would
  // surface as an unhandled rejection, not a useful signal. Log metadata only:
  // never the email, token, or reset URL (all Restricted -- SECURITY.md §1).
  after(async () => {
    try {
      const user = await prismaUnfiltered.user.findUnique({
        where: { email, deletedAt: null },
        select: { id: true },
      });
      if (!user) return;

      // Invalidate any prior reset tokens for this identifier before issuing a
      // new one: a re-request silently revokes older emailed links (only the
      // latest is valid) and keeps verification_tokens bounded between the daily
      // cron GCs (SR-L1). VerificationToken is in the audit/soft-delete EXCLUDE
      // set, so this bulk delete is allowed and unaudited by design.
      await prismaUnfiltered.verificationToken.deleteMany({ where: { identifier: email } });

      const token = randomBytes(32).toString("base64url");
      await prismaUnfiltered.verificationToken.create({
        data: { identifier: email, token, expires: new Date(Date.now() + TOKEN_TTL_MS) },
      });

      const url = `${origin}/reset-password?token=${token}`;
      // Body may carry the reset URL (Restricted) -- lib/email logs metadata only.
      await sendEmail({
        to: email,
        subject: "Reset your password",
        text: `Open ${url} to reset your password. This link expires in 1 hour. If you didn't request this, ignore this email.`,
        html: `<p>Open <a href="${url}">this link</a> to reset your password. Expires in 1 hour.</p><p>If you didn't request this, ignore this email.</p>`,
      });
    } catch (e) {
      console.error("forgot-password: async reset delivery failed", {
        name: e instanceof Error ? e.name : "Unknown",
      });
    }
  });

  return neutral;
}
