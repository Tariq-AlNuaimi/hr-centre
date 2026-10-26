import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listEmploymentTypeConfigs } from "@/lib/jml/config";
import { jml, requireAnywhere } from "@/lib/jml/route";

export const GET = withRateLimit(
  withAuth(
    jml(
      async ({ actor }) => (
        requireAnywhere(actor, "jml.view"),
        ok(await listEmploymentTypeConfigs())
      ),
    ),
  ),
  { id: "jml-employment-types-read", limit: 120, windowMs: 60_000 },
);
