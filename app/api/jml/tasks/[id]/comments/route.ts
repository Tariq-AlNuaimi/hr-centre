import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { addComment, listComments } from "@/lib/jml/engine/tasks";
import { body, jml } from "@/lib/jml/route";
import { commentSchema } from "@/lib/validations/jml/task";

/** Comments are insert-only: there is no edit or delete route, by design. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listComments(actor, params.id!)))),
  { id: "jml-comments-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(await addComment(actor, params.id!, (await body(req, commentSchema)).body)),
    ),
  ),
  { id: "jml-comments-write", limit: 60, windowMs: 60_000 },
);
