import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { reassignOwner } from "@/lib/jml/engine/case-actions";
import { body, jml } from "@/lib/jml/route";
import { ownerSchema } from "@/lib/validations/jml/case";

/** Reassign the case owner (jml.supervise); open tasks follow by default. */
export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, ownerSchema);
      return ok(await reassignOwner(actor, params.id!, input));
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
