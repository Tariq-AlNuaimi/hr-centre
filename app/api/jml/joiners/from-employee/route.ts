import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { startJoinCaseFromRecord } from "@/lib/jml/join/open-join";
import { body, jml } from "@/lib/jml/route";
import { startJoinerFromEmployeeSchema } from "@/lib/validations/jml/joiner";

/**
 * "Start joiner case" from an employee record (PRE_JOINER without a live
 * onboarding). Scope-checked in the service: out of scope is a 404.
 */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      const { employeeId } = await body(req, startJoinerFromEmployeeSchema);
      const result = await startJoinCaseFromRecord(actor, employeeId);
      return result.created ? created(result) : ok(result);
    }),
  ),
  { id: "jml-joiners-write", limit: 30, windowMs: 60_000 },
);
