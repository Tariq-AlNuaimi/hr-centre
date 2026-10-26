import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { confirmPayment } from "@/lib/jml/leave/settlement-actions";
import { body, jml } from "@/lib/jml/route";
import { paymentSchema } from "@/lib/validations/jml/leave";

/** Confirm payment with its reference (C5 window reported). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await confirmPayment(actor, params.id!, await body(req, paymentSchema))),
    ),
  ),
  { id: "jml-settlement-write", limit: 30, windowMs: 60_000 },
);
