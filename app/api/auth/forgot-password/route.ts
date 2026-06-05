import { NextRequest, after } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prismaUnfiltered } from "@/lib/prisma";
import { ok, err } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";

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
  const limit = rateLimit(req, { id: "auth-reset", limit: 5, windowMs: 60_000 });
  if (!limit.ok) {
    return err("Too many requests", 429);
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  // Neutral response regardless of validity (no enumeration / no error oracle).
  const neutral = ok({ message: "If that email exists, a reset link was sent." });
  if (!parsed.success) return neutral;

  const email = parsed.data.email.toLowerCase();
  const origin = req.nextUrl.origin; // capture before the response is sent

  // Do the existence-dependent work AFTER the response flushes, so the response
  // time is identical whether or not the account exists (closes the enumeration
  // timing oracle). Errors here are logged by the runtime and never reach the
  // already-sent neutral response.
  after(async () => {
    const user = await prismaUnfiltered.user.findUnique({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (!user) return;

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
  });

  return neutral;
}
