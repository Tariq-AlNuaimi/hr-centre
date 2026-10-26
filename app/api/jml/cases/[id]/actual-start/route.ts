import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { confirmActualStart } from "@/lib/jml/join/actions";
import { body, jml } from "@/lib/jml/route";
import { actualStartSchema } from "@/lib/validations/jml/case";

/** Confirm the actual start (once; not in the future): the employee becomes ACTIVE. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, actualStartSchema);
      return ok(await confirmActualStart(actor, params.id!, input.actualStartDate));
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
