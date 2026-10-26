import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { searchCases } from "@/lib/jml/search";
import { searchSchema } from "@/lib/validations/jml/case";

/** Case search (AC-DASH-008), 30 per minute. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      return ok({ hits: await searchCases(actor, query(req, searchSchema).q) });
    }),
  ),
  { id: "jml-search", limit: 30, windowMs: 60_000 },
);
