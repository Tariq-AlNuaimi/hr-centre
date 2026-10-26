import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { statutoryWatch } from "@/lib/jml/watch/statutory";
import { statutoryWatchSchema } from "@/lib/validations/jml/case";

/** Statutory & visa watch (FR-DASH-008): at-risk by default, `all=true` adds scheduled. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const q = query(req, statutoryWatchSchema);
      const includeScheduled = q.all === "true";
      const rows = await statutoryWatch(actor, { mine: q.mine === "true", includeScheduled });
      return ok({ rows, includeScheduled });
    }),
  ),
  { id: "jml-watch-read", limit: 60, windowMs: 60_000 },
);
