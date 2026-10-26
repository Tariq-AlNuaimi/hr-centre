import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { getInterview, saveInterview } from "@/lib/jml/leave/interview";
import { body, jml } from "@/lib/jml/route";
import { interviewSchema } from "@/lib/validations/jml/leave";

/** The interview, its assessment and the active taxonomy. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await getInterview(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Record or update the interview (codes checked against the taxonomy). */
export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await saveInterview(actor, params.id!, await body(req, interviewSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
