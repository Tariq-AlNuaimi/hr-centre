import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { caseActivity } from "@/lib/jml/engine/activity";
import { jml } from "@/lib/jml/route";

/** The case's audit timeline (field names only, never values). */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await caseActivity(actor, params.id!)))),
  { id: "jml-cases-read", limit: 120, windowMs: 60_000 },
);
