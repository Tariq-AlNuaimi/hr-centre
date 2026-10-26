import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { updateContractType } from "@/lib/jml/config";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { contractTypeUpdateSchema } from "@/lib/validations/jml/config";

export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await updateContractType(params.id!, await body(req, contractTypeUpdateSchema)));
    }),
  ),
  { id: "jml-contract-types-write", limit: 30, windowMs: 60_000 },
);
