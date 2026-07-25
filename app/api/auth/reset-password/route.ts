import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { hashPassword } from "@/lib/password";
import { z } from "zod";
import { prisma, prismaUnfiltered } from "@/lib/prisma";
import { ok, err } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";

// PUBLIC route (middleware allows /api/auth/*). Completes a password reset:
// validates the one-time token from VerificationToken, sets the new password
// (via the audited client -- passwordHash is scrubbed), and burns all of the
// user's reset tokens. Generic errors so the token can't be probed.

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export async function POST(req: NextRequest): Promise<Response> {
  // Distinct bucket from forgot-password so exhausting one doesn't lock the other.
  const limit = await rateLimit(req, { id: "auth-reset-complete", limit: 5, windowMs: 60_000 });
  if (!limit.ok) return err("Too many requests", 429);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  // Look the token up by DIGEST -- only the hash is stored (see the companion
  // comment in forgot-password). Equality on the digest, so no timing concern
  // beyond what the DB index already gives.
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prismaUnfiltered.verificationToken.findUnique({
    where: { token: tokenHash },
  });
  if (!record || record.expires < new Date()) {
    return err("This reset link is invalid or has expired.", 400);
  }

  // `deletedAt: null` mirrors the filter forgot-password applies when ISSUING the
  // token. Without it an off-boarded (soft-deleted) account's passwordHash could
  // still be rewritten inside the 1h window using a token minted before removal.
  // Both login paths already block soft-deleted users, so this is consistency
  // rather than an exploit -- but the two halves of the flow should agree.
  const user = await prismaUnfiltered.user.findFirst({
    where: { email: record.identifier, deletedAt: null },
    select: { id: true },
  });
  if (!user) {
    // Token referenced a now-missing or off-boarded user -- burn it and fail closed.
    await prismaUnfiltered.verificationToken.deleteMany({
      where: { identifier: record.identifier },
    });
    return err("This reset link is invalid or has expired.", 400);
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  // Audited client: the password change lands in audit_logs (hash scrubbed),
  // attributed to null actor (no session) -- a deliberate, queryable record.
  // passwordChangedAt invalidates every existing JWT session for this user on
  // its next request (see lib/auth.ts jwt callback) -- the reset must end any
  // session a compromise may have opened.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  // One-time use: remove every reset token for this identifier.
  await prismaUnfiltered.verificationToken.deleteMany({ where: { identifier: record.identifier } });

  return ok({ reset: true });
}
