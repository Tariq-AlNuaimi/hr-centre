import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created } from "@/lib/api-response";
import { addSettlementLine } from "@/lib/jml/leave/settlement-actions";
import { body, jml } from "@/lib/jml/route";
import { settlementLineSchema } from "@/lib/validations/jml/leave";

/** Add an addition or a referenced deduction (C4). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(await addSettlementLine(actor, params.id!, await body(req, settlementLineSchema))),
    ),
  ),
  { id: "jml-settlement-write", limit: 30, windowMs: 60_000 },
);
