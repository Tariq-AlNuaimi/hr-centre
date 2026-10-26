import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { canFor } from "@/lib/jml/access";
import { JmlError } from "@/lib/jml/errors";
import { loadMoveEmployee } from "@/lib/jml/move/profile";
import { body, jml } from "@/lib/jml/route";
import { recordEmployeeCode } from "@/lib/people/employee-code";
import { employeeCodeForEmployeeSchema } from "@/lib/validations/jml/move";

/**
 * Record the EMP code of an existing employee (Onboarding R2): free, and below
 * the range the system issues once the cutover exists. Codes never change.
 */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const { subject } = await loadMoveEmployee(actor, params.id!);
      if (
        !canFor(actor, "jml.manageMovers", subject) &&
        !canFor(actor, "jml.manageJoiners", subject)
      ) {
        throw new JmlError("You cannot record employee codes for this employee.", 403);
      }
      const input = await body(req, employeeCodeForEmployeeSchema);
      return ok({ employeeCode: await recordEmployeeCode(params.id!, input.employeeCode) });
    }),
  ),
  { id: "jml-movers-write", limit: 20, windowMs: 60_000 },
);
