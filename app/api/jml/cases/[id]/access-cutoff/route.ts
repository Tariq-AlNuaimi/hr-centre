import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { setAccessCutoff } from "@/lib/jml/register/access-items";
import { body, jml } from "@/lib/jml/route";
import { accessCutoffSchema } from "@/lib/validations/jml/leave";

/**
 * P2-5 — set or clear a leaver's access cut-off. `at` is a wall-clock time in
 * the organisation's zone ("YYYY-MM-DDTHH:mm"); null restores the default
 * (17:00 on the Last Physical Working Day). Needs `jml.manageLeavers` in scope.
 */
export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, accessCutoffSchema);
      return ok(await setAccessCutoff(actor, params.id!, input.at));
    }),
  ),
  { id: "jml-register-write", limit: 60, windowMs: 60_000 },
);
