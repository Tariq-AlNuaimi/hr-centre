import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { confirmItReadiness } from "@/lib/jml/join/actions";
import { body, jml } from "@/lib/jml/route";
import { itReadinessSchema } from "@/lib/validations/jml/case";

/** Confirm (or withdraw) IT readiness for a joiner. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, itReadinessSchema);
      return ok(await confirmItReadiness(actor, params.id!, input.confirmed));
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
