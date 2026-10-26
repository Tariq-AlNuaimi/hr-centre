import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { updatePositionClassification } from "@/lib/jml/config";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { classificationUpdateSchema } from "@/lib/validations/jml/config";

export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(
        await updatePositionClassification(params.id!, await body(req, classificationUpdateSchema)),
      );
    }),
  ),
  { id: "jml-classifications-write", limit: 30, windowMs: 60_000 },
);
