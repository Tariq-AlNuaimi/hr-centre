import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { cancelLeave } from "@/lib/jml/leave/cancel";
import { body, jml } from "@/lib/jml/route";
import { cancelExitSchema } from "@/lib/validations/jml/leave";

/** Withdraw the exit: reversal tasks, and the departure undone if it applied. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await cancelLeave(actor, params.id!, await body(req, cancelExitSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
