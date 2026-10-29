import { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isAccountLocked, recordFailedLogin, clearFailedLogins } from "@/lib/account-lockout";
import { prisma } from "@/lib/prisma";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err, forbidden } from "@/lib/api-response";
import { z } from "zod";
import { AUTH_LIMITS, throttlePasswordChange, tooManyRequests } from "@/lib/rate-limit";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
});

// Rate-limited AND lockout-backed: this route verifies currentPassword, so it is
// an online password-guessing oracle even though it is self-scoped.
//
// The per-IP limiter alone was insufficient (2026-07-25 review): an attacker
// holding a stolen SESSION but not the password could rotate IPs and get
// unbounded guesses at the plaintext -- useful for credential reuse elsewhere,
// and for persisting past `session.maxAge` by changing the password. The login
// path already solves exactly this per-IDENTITY via lib/account-lockout.ts; this
// route just never called it. Same counter as login, so guesses across both
// surfaces accumulate against one budget.
export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;

    // Users can only change their own password
    if (id !== session.user.id) return forbidden();

    // 5/min per signed-in user, shared with the forced first-login change
    // (POST /api/logins/change-password); 60/min per IP outside (ADR-100).
    const userLimit = await throttlePasswordChange(session.user.id);
    if (!userLimit.ok) return tooManyRequests(userLimit);

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { passwordHash: true, email: true },
    });

    if (!user?.passwordHash) {
      return err("Password change not available for OAuth accounts");
    }

    // Checked BEFORE the Argon2 verify, mirroring lib/auth.ts: a locked account
    // must not spend CPU on a hash it will reject anyway.
    if (await isAccountLocked(user.email)) {
      return err("Too many failed attempts. Try again later.", 429);
    }

    const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      await recordFailedLogin(user.email);
      return err("Current password is incorrect", 403);
    }
    await clearFailedLogins(user.email);

    const passwordHash = await hashPassword(parsed.data.newPassword);
    // Stamp passwordChangedAt so the jwt callback revokes every existing session
    // for this user (lib/auth.ts) -- a password change must end other sessions.
    await prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    return ok({ changed: true });
  }),
  AUTH_LIMITS.passwordChangeIp,
);
