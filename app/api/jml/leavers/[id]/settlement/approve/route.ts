import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { approveSettlement } from "@/lib/jml/leave/settlement-actions";
import { body, jml } from "@/lib/jml/route";
import { approveSettlementSchema } from "@/lib/validations/jml/leave";

/** Approve: verified figures, referenced deductions, settled assets, both signatures. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await approveSettlement(actor, params.id!, await body(req, approveSettlementSchema))),
    ),
  ),
  { id: "jml-settlement-write", limit: 30, windowMs: 60_000 },
);
