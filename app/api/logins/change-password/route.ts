import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { changeOwnPassword } from "@/lib/people/logins";
import { changePasswordSchema } from "@/lib/validations/login";

/**
 * The signed-in user replaces their (temporary) password — AC-F4.2. Reachable
 * while `mustChangePassword` is set (lib/people/force-change.ts allows it).
 * Changing it stamps `passwordChangedAt`, so the current session ends and the
 * page signs in again with the new password.
 */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
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
  { id: "logins-change-password", limit: 5, windowMs: 60_000 },
);
