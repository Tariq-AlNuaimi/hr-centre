import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { setLegalHold } from "@/lib/jml/engine/case-actions";
import { body, jml } from "@/lib/jml/route";
import { legalHoldSchema } from "@/lib/validations/jml/case";

/** Place or lift a legal hold (jml.supervise). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, legalHoldSchema);
      return ok(await setLegalHold(actor, params.id!, input));
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
