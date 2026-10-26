import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created } from "@/lib/api-response";
import { createMove } from "@/lib/jml/move/create";
import { body, jml } from "@/lib/jml/route";
import { createMoveSchema } from "@/lib/validations/jml/move";

/** Start an internal change (Onboarding R1–R10): a MOVE case, applied when it completes. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) =>
      created(await createMove(actor, await body(req, createMoveSchema))),
    ),
  ),
  { id: "jml-movers-write", limit: 20, windowMs: 60_000 },
);
