import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { removeSettlementLine } from "@/lib/jml/leave/settlement-actions";
import { jml } from "@/lib/jml/route";

/** Remove a line before approval. */
export const DELETE = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) =>
      ok(await removeSettlementLine(actor, params.id!, params.lineId!)),
    ),
  ),
  { id: "jml-settlement-write", limit: 30, windowMs: 60_000 },
);
