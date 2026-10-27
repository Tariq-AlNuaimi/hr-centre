import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { closeLeave, closurePreview } from "@/lib/jml/leave/closure";
import { body, jml } from "@/lib/jml/route";
import { closeExitSchema } from "@/lib/validations/jml/leave";

/** What still stands in the way of closing. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await closurePreview(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Close: gates, settlement paid, departure applied (jml.closeLeavers). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await closeLeave(actor, params.id!, await body(req, closeExitSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
