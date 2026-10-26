import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { activateLeave, previewLeaveActivation } from "@/lib/jml/leave/activation";
import { jml } from "@/lib/jml/route";

/** Every activation blocker at once. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await previewLeaveActivation(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Activate: owner, template, tasks, revocation items, assets to return — atomically. */
export const POST = withRateLimit(
  withAuth(jml(async ({ params, actor }) => created(await activateLeave(actor, params.id!)))),
  { id: "jml-leavers-activate", limit: 20, windowMs: 60_000 },
);
