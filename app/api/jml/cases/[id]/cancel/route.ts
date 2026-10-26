import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { cancelCase } from "@/lib/jml/engine/case-actions";
import { body, jml } from "@/lib/jml/route";
import { cancelSchema } from "@/lib/validations/jml/case";

/** Cancel a joiner or mover case (reason 10–1000 characters; open tasks and queued messages cancelled). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, cancelSchema);
      return ok(await cancelCase(actor, params.id!, input.reason));
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
