import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { updateTask } from "@/lib/jml/engine/task-update";
import { body, jml } from "@/lib/jml/route";
import { updateTaskSchema } from "@/lib/validations/jml/task";

/**
 * One door for a task: status (complete / N/A / reopen / delay / waiting),
 * due date, owner, reference and the confirmation trio. Scope- and
 * permission-checked in the service (404 out of scope, 403 without the right).
 */
export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await updateTask(actor, params.id!, await body(req, updateTaskSchema))),
    ),
  ),
  { id: "jml-task-write", limit: 120, windowMs: 60_000 },
);
