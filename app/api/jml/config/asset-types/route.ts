import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listAssetTypes, saveAssetType } from "@/lib/jml/leave/config";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { assetTypeSchema } from "@/lib/validations/jml/leave";

/** Asset types (deactivated, never deleted). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await listAssetTypes());
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await saveAssetType(await body(req, assetTypeSchema)));
    }),
  ),
  { id: "jml-config-write", limit: 30, windowMs: 60_000 },
);
