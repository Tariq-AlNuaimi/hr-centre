import { withInternalAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { withAuditContext } from "@/lib/audit-context";
import { runHiringRetention } from "@/lib/hiring/retention";

/**
 * Daily hiring PDPL retention (docs/blueprints/hiring-insights.md). Vercel Cron
 * issues GET with `Authorization: Bearer $CRON_SECRET`; a silent no-op while the
 * secret is unset. POST is the manual door with the same secret as
 * `x-internal-token`. Erasure is idempotent: an erased candidate is skipped.
 */

export const maxDuration = 60;

async function sweep() {
  return withAuditContext({ actorEmail: "hiring-retention@system" }, async () =>
    ok(await runHiringRetention()),
  );
}

export const GET = withRateLimit(
  withInternalAuth("CRON_SECRET", sweep, { bearer: true, skipWhenUnconfigured: true }),
  { id: "hiring-retention-cron", limit: 5, windowMs: 60_000 },
);

export const POST = withRateLimit(withInternalAuth("CRON_SECRET", sweep), {
  id: "hiring-retention-manual",
  limit: 5,
  windowMs: 60_000,
});
