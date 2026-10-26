import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { heldJmlPermissions } from "@/lib/jml/access";
import { jml } from "@/lib/jml/route";

/** The JML permissions the signed-in user holds anywhere — affordances only; routes re-check. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => ok({ permissions: heldJmlPermissions(actor), userId: actor.userId })),
  ),
  { id: "jml-me", limit: 120, windowMs: 60_000 },
);
