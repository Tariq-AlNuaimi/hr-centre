import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { archiveCase } from "@/lib/jml/engine/case-actions";
import { jml } from "@/lib/jml/route";

/** Archive a finished or cancelled case (jml.supervise). Nothing is deleted. */
export const POST = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await archiveCase(actor, params.id!)))),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
