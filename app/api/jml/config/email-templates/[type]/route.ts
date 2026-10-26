import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { JmlError } from "@/lib/jml/errors";
import { body, jml, requireGroup } from "@/lib/jml/route";
import {
  resetTemplateOverride,
  resolveTemplate,
  saveTemplateOverride,
} from "@/lib/jml/email/overrides";
import { emailOverrideSchema } from "@/lib/validations/jml/config";

function found<T>(t: T | undefined): T {
  if (!t) throw new JmlError("Unknown email type", 404);
  return t;
}

export const GET = withRateLimit(
  withAuth(
    jml(
      async ({ params, actor }) => (
        requireGroup(actor, "jml.configure"),
        ok(found(await resolveTemplate(params.type!)))
      ),
    ),
  ),
  { id: "jml-email-templates-read", limit: 120, windowMs: 60_000 },
);

/** Shadow subject / body / cc; `null` clears a field; clearing all deletes the override. */
export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      const input = await body(req, emailOverrideSchema);
      return ok(found(await saveTemplateOverride(params.type!, input, actor.userId)));
    }),
  ),
  { id: "jml-email-templates-write", limit: 30, windowMs: 60_000 },
);

/** Reset to the approved copy. */
export const DELETE = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(found(await resetTemplateOverride(params.type!)));
    }),
  ),
  { id: "jml-email-templates-write", limit: 30, windowMs: 60_000 },
);
