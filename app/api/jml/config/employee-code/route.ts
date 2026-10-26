import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { configureEmployeeCodeSequence, getEmployeeCodeSequence } from "@/lib/people/employee-code";
import { body, jml, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { employeeCodeSchema } from "@/lib/validations/jml/config";

/** The EMP-code cutover (Onboarding §14.1, BR-021): absent until HR records it. */
export const GET = withRateLimit(
  withAuth(
    jml(
      async ({ actor }) => (
        requireAnywhere(actor, "jml.view"),
        ok(await getEmployeeCodeSequence())
      ),
    ),
  ),
  { id: "jml-employee-code-read", limit: 60, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await configureEmployeeCodeSequence(await body(req, employeeCodeSchema)));
    }),
  ),
  { id: "jml-employee-code-write", limit: 10, windowMs: 60_000 },
);
