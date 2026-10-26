import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { getCaseDetail } from "@/lib/jml/engine/case-read";
import { jml } from "@/lib/jml/route";

/** One case (any type) with the actor's affordances. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await getCaseDetail(actor, params.id!)))),
  { id: "jml-cases-read", limit: 120, windowMs: 60_000 },
);
