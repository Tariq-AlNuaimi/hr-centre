import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { updateAssignmentRule } from "@/lib/jml/engine/assignment";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { ruleUpdateSchema } from "@/lib/validations/jml/config";

export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await updateAssignmentRule(params.id!, await body(req, ruleUpdateSchema)));
    }),
  ),
  { id: "jml-rules-write", limit: 30, windowMs: 60_000 },
);
