import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { applyRekey, rekeyPlan } from "@/lib/jml/leave/rekey";
import { body, jml } from "@/lib/jml/route";
import { rekeySchema } from "@/lib/validations/jml/leave";

/** The tasks due before today that need an answer. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await rekeyPlan(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Activate a back-dated exit and record each past task's outcome. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await applyRekey(actor, params.id!, await body(req, rekeySchema))),
    ),
  ),
  { id: "jml-leavers-activate", limit: 20, windowMs: 60_000 },
);
