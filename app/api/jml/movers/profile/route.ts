import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { moveProfile } from "@/lib/jml/move/profile";
import { jml, query } from "@/lib/jml/route";
import { moveEmployeeQuery } from "@/lib/validations/jml/move";

/** An employee's current details, eligibility and change history (Onboarding /employees/[id]). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) =>
      ok(await moveProfile(actor, query(req, moveEmployeeQuery).employeeId)),
    ),
  ),
  { id: "jml-movers-read", limit: 120, windowMs: 60_000 },
);
