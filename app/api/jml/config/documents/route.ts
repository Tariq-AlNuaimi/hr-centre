import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { listTemplates, uploadTemplate } from "@/lib/jml/docs/templates";
import { body, jml, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { uploadTemplateSchema } from "@/lib/validations/jml/leave";

/** Every template version, newest first per type. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireAnywhere(actor, "jml.configure");
      return ok(await listTemplates(actor));
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);

/** Upload a .docx as a new DRAFT version (allowlisted placeholders only). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return created(await uploadTemplate(actor, await body(req, uploadTemplateSchema)));
    }),
  ),
  { id: "jml-config-write", limit: 20, windowMs: 60_000 },
);
