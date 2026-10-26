import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { writeOffAsset } from "@/lib/jml/register/assets";
import { body, jml } from "@/lib/jml/route";
import { assetWriteOffSchema } from "@/lib/validations/jml/leave";

/** Write an unreturned asset off with a reason. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(
        await writeOffAsset(
          actor,
          params.id!,
          params.assetId!,
          (await body(req, assetWriteOffSchema)).reason,
        ),
      ),
    ),
  ),
  { id: "jml-register-write", limit: 60, windowMs: 60_000 },
);
