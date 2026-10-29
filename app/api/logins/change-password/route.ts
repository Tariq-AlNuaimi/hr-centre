import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { changeOwnPassword } from "@/lib/people/logins";
import { changePasswordSchema } from "@/lib/validations/login";
import { AUTH_LIMITS, throttlePasswordChange, tooManyRequests } from "@/lib/rate-limit";

/**
 * The signed-in user replaces their (temporary) password — AC-F4.2. Reachable
 * while `mustChangePassword` is set (lib/people/force-change.ts allows it).
 * Changing it stamps `passwordChangedAt`, so the current session ends and the
 * page signs in again with the new password.
 */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    // 5/min per signed-in user, shared with PUT /api/users/[id]/password (ADR-100).
    const userLimit = await throttlePasswordChange(session.user.id);
    if (!userLimit.ok) return tooManyRequests(userLimit);
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return ok(
        await changeOwnPassword(
          session.user.id,
          parsed.data.currentPassword,
          parsed.data.newPassword,
        ),
      );
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  AUTH_LIMITS.passwordChangeIp,
);
