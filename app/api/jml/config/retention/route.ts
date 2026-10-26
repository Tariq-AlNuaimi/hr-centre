import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { previewRetention } from "@/lib/jml/join/retention";
import { jml, requireGroup } from "@/lib/jml/route";

/** The retention rule and a dry run (nothing is changed from here). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await previewRetention());
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);
