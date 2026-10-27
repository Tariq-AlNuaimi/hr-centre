import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { calculateSettlement, getSettlement } from "@/lib/jml/leave/settlement";
import { body, jml } from "@/lib/jml/route";
import { calculateSettlementSchema } from "@/lib/validations/jml/leave";

/** The settlement: status for every HR viewer, figures only with jml.viewSettlement. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await getSettlement(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Calculate (or recalculate) gratuity, leave and totals from the core record. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await calculateSettlement(actor, params.id!, await body(req, calculateSettlementSchema))),
    ),
  ),
  { id: "jml-settlement-write", limit: 30, windowMs: 60_000 },
);
