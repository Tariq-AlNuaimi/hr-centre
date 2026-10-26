import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { addAsset, listCaseAssets } from "@/lib/jml/register/assets";
import { body, jml } from "@/lib/jml/route";
import { addAssetSchema } from "@/lib/validations/jml/leave";

/** Assets issued on, or to be returned on, this case. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listCaseAssets(actor, params.id!)))),
  { id: "jml-register-read", limit: 120, windowMs: 60_000 },
);

/** Issue an asset (joiner) or add one to return (leaver). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(await addAsset(actor, params.id!, await body(req, addAssetSchema))),
    ),
  ),
  { id: "jml-register-write", limit: 60, windowMs: 60_000 },
);
