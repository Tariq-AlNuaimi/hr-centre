import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created } from "@/lib/api-response";
import { createExitDraft } from "@/lib/jml/leave/draft";
import { body, jml } from "@/lib/jml/route";
import { createExitSchema } from "@/lib/validations/jml/leave";

/** Open an exit draft for an employee (EXIT-YYYY-NNNN; no tasks until activation). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) =>
      created(await createExitDraft(actor, await body(req, createExitSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
