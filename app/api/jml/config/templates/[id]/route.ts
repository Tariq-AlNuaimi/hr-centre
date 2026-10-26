import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { getTemplate, updateTemplate } from "@/lib/jml/engine/templates";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { updateTemplateSchema } from "@/lib/validations/jml/template";

export const GET = withRateLimit(
  withAuth(
    jml(
      async ({ params, actor }) => (
        requireGroup(actor, "jml.configure"),
        ok(await getTemplate(params.id!))
      ),
    ),
  ),
  { id: "jml-templates-read", limit: 120, windowMs: 60_000 },
);

/** A definition change cuts a new version (BR-016); `active` alone toggles in place. */
export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await updateTemplate(params.id!, await body(req, updateTemplateSchema)));
    }),
  ),
  { id: "jml-templates-write", limit: 30, windowMs: 60_000 },
);
