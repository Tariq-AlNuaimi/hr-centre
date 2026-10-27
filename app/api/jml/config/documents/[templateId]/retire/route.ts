import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { retireTemplate } from "@/lib/jml/docs/templates";
import { jml, requireGroup } from "@/lib/jml/route";

/** Retire the active template of a type. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      requireGroup(actor, "jml.activateDocuments");
      return ok(await retireTemplate(params.templateId!));
    }),
  ),
  { id: "jml-config-write", limit: 20, windowMs: 60_000 },
);
