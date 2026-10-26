import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { recordAssetReturn } from "@/lib/jml/register/assets";
import { body, jml } from "@/lib/jml/route";
import { assetReturnSchema } from "@/lib/validations/jml/leave";

/** Record a return (a deduction amount needs jml.manageSettlement). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(
        await recordAssetReturn(
          actor,
          params.id!,
          params.assetId!,
          await body(req, assetReturnSchema),
        ),
      ),
    ),
  ),
  { id: "jml-register-write", limit: 60, windowMs: 60_000 },
);
