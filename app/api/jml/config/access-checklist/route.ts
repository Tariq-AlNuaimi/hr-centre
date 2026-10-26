import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listAccessChecklist, saveAccessChecklistItem } from "@/lib/jml/leave/config";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { accessChecklistSchema } from "@/lib/validations/jml/leave";

/** The access-revocation checklist every exit activation copies. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await listAccessChecklist());
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await saveAccessChecklistItem(await body(req, accessChecklistSchema)));
    }),
  ),
  { id: "jml-config-write", limit: 30, windowMs: 60_000 },
);
