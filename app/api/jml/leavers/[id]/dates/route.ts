import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { changeExitDates } from "@/lib/jml/leave/dates";
import { body, jml } from "@/lib/jml/route";
import { exitDatesSchema } from "@/lib/validations/jml/leave";

/** The date model, type and branch; recalculates open tasks on an active case (AC-3.3–3.6). */
export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await changeExitDates(actor, params.id!, await body(req, exitDatesSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
