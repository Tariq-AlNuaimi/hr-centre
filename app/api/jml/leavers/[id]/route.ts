import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { updateExit } from "@/lib/jml/leave/draft";
import { getExit } from "@/lib/jml/leave/read";
import { body, jml } from "@/lib/jml/route";
import { updateExitSchema } from "@/lib/validations/jml/leave";

/** The exit view of a case. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await getExit(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Classification, flags, documentation refs, backfill and rehire. */
export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await updateExit(actor, params.id!, await body(req, updateExitSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
