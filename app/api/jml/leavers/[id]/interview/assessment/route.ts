import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { assessInterview } from "@/lib/jml/leave/interview";
import { body, jml } from "@/lib/jml/route";
import { assessmentSchema } from "@/lib/validations/jml/leave";

/** Regrettable / preventable assessment (jml.assessExits). */
export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await assessInterview(actor, params.id!, await body(req, assessmentSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
