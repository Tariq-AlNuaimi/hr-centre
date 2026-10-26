import { withInternalAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { withAuditContext } from "@/lib/audit-context";
import { runSweep } from "@/lib/jml/sweep";

/**
 * The hourly JML sweep (docs/blueprints/jml.md). Vercel Cron issues GET with
 * `Authorization: Bearer $CRON_SECRET` and the route is a silent no-op while
 * the secret is unset; POST is the manual door with the same secret as
 * `x-internal-token`. Every step is idempotent (dedupe keys, status guards), so
 * an overlapping or repeated run is safe.
 */

export const maxDuration = 60;

async function sweep() {
  return withAuditContext({ actorEmail: "jml-sweep@system" }, async () => ok(await runSweep()));
}

export const GET = withRateLimit(
  withInternalAuth("CRON_SECRET", sweep, { bearer: true, skipWhenUnconfigured: true }),
  { id: "jml-sweep-cron", limit: 5, windowMs: 60_000 },
);

export const POST = withRateLimit(withInternalAuth("CRON_SECRET", sweep), {
  id: "jml-sweep-manual",
  limit: 5,
  windowMs: 60_000,
});
