import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { getDeskSettings, saveDeskSettings } from "@/lib/jml/routing/desks";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { deskSettingsSchema } from "@/lib/validations/jml/routing";

/** Task routing: the named people on the IT and Finance desks (org-wide configuration). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await getDeskSettings());
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await saveDeskSettings(await body(req, deskSettingsSchema)));
    }),
  ),
  { id: "jml-task-routing-write", limit: 20, windowMs: 60_000 },
);
