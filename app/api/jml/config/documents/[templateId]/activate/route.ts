import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { activateTemplate } from "@/lib/jml/docs/templates";
import { jml, requireGroup } from "@/lib/jml/route";

/** Activate a draft (HR Manager; never the uploader) — retires the active one. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      requireGroup(actor, "jml.activateDocuments");
      return ok(await activateTemplate(actor, params.templateId!));
    }),
  ),
  { id: "jml-config-write", limit: 20, windowMs: 60_000 },
);
