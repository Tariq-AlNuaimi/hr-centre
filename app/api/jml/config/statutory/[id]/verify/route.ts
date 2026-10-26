import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { verifyStatutory } from "@/lib/jml/config";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { statutoryVerifySchema } from "@/lib/validations/jml/config";

/**
 * Confirm (or withdraw) a statutory figure — the HR Manager's act (Offboarding:
 * it removes the Provisional watermark and unblocks Final Settlement Approval).
 */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.verifyStatutory");
      const input = await body(req, statutoryVerifySchema);
      return ok(
        await verifyStatutory(
          params.id!,
          input.verified,
          input.sourceReference ?? null,
          actor.userId,
        ),
      );
    }),
  ),
  { id: "jml-statutory-write", limit: 30, windowMs: 60_000 },
);
