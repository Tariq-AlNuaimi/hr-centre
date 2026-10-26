import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { saveEmploymentTypeConfig } from "@/lib/jml/config";
import { JmlError } from "@/lib/jml/errors";
import { body, jml, requireGroup } from "@/lib/jml/route";
import {
  employmentTypeConfigSchema,
  employmentTypeParamSchema,
} from "@/lib/validations/jml/config";

export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      const type = employmentTypeParamSchema.safeParse(params.type);
      if (!type.success) throw new JmlError("Unknown employment type", 404);
      return ok(
        await saveEmploymentTypeConfig(type.data, await body(req, employmentTypeConfigSchema)),
      );
    }),
  ),
  { id: "jml-employment-types-write", limit: 30, windowMs: 60_000 },
);
