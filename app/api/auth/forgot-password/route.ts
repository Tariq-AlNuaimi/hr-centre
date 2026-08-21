import { NextRequest, after } from "next/server";
import { randomBytes, createHash } from "node:crypto";
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

const schema = z.object({ email: z.email() });
const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  // Neutral response regardless of validity (no enumeration / no error oracle).
  const neutral = ok({ message: "If that email exists, a reset link was sent." });

  // Throttle AFTER parsing so the requested address can key its own bucket. The
  // per-IP key is derived from a header that, on a deployment with no trusted
  // proxy, the caller controls -- rotating it mints a fresh IP bucket per request
  // and the reset limit stops meaning anything. The address survives rotation, so
  // it is what actually caps reset-spam aimed at one mailbox (review round 8).
  // Parsing before throttling costs one JSON.parse of a bounded body; a 429 here
  // is driven purely by request volume, never by whether the account exists, so
  // the anti-enumeration property is unchanged.
  const limit = await rateLimit(req, {
    id: "auth-reset",
    limit: 5,
    windowMs: 60_000,
    subject: parsed.success ? parsed.data.email.toLowerCase() : undefined,
  });
  if (!limit.ok) {
    return err("Too many requests", 429);
  }

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

      // The raw token goes in the EMAIL; only its SHA-256 digest is persisted.
      // Storing the raw value made `verification_tokens` a table of live bearer
      // credentials: anyone who could READ it -- a Neon branch or snapshot, a
      // backup, a support query, a future read-only SQL surface -- could complete
      // a reset on any account with an outstanding token, no password needed.
      // That is precisely the capability Argon2-hashing `passwordHash` exists to
      // deny, reintroduced for a 1-hour window per account (2026-07-25 review).
      // A digest is sufficient because the lookup is by exact equality, not a
      // range scan, and SHA-256 is right here (not Argon2) because the input is
      // 32 bytes of CSPRNG output, not a low-entropy human secret -- there is no
      // dictionary to slow down.
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await prismaUnfiltered.verificationToken.create({
        data: { identifier: email, token: tokenHash, expires: new Date(Date.now() + TOKEN_TTL_MS) },
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
