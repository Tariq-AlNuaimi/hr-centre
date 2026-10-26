import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { addAccessItem, listAccessItems } from "@/lib/jml/register/access-items";
import { body, jml } from "@/lib/jml/route";
import { addAccessSchema } from "@/lib/validations/jml/leave";

/** Access to grant (joiner) or revoke (leaver), with unrotated shared credentials. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listAccessItems(actor, params.id!)))),
  { id: "jml-register-read", limit: 120, windowMs: 60_000 },
);

/** Add an access item by hand. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(await addAccessItem(actor, params.id!, await body(req, addAccessSchema))),
    ),
  ),
  { id: "jml-register-write", limit: 60, windowMs: 60_000 },
);
