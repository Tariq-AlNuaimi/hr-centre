import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { heldJmlPermissions } from "@/lib/jml/access";
import { hasWorkerTasks } from "@/lib/jml/routing/worker";
import { jml } from "@/lib/jml/route";

/**
 * The JML permissions the signed-in user holds anywhere — affordances only;
 * routes re-check. `taskWorker`: they have open desk or line-manager tasks
 * routed to them (task routing — derived, not a permission), so My tasks shows.
 */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) =>
      ok({
        permissions: heldJmlPermissions(actor),
        userId: actor.userId,
        taskWorker: await hasWorkerTasks(actor),
      }),
    ),
  ),
  { id: "jml-me", limit: 120, windowMs: 60_000 },
);
