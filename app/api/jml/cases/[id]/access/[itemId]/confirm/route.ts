import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { confirmAccessItem } from "@/lib/jml/register/access-items";
import { body, jml } from "@/lib/jml/route";
import { confirmAccessSchema } from "@/lib/validations/jml/leave";

/** Confirm an item granted or revoked (party + date + reference). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(
        await confirmAccessItem(
          actor,
          params.id!,
          params.itemId!,
          await body(req, confirmAccessSchema),
        ),
      ),
    ),
  ),
  { id: "jml-register-write", limit: 60, windowMs: 60_000 },
);
