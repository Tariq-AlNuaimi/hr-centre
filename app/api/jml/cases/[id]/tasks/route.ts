import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { addManualTask, listTasks } from "@/lib/jml/engine/tasks";
import { body, jml } from "@/lib/jml/route";
import { manualTaskSchema } from "@/lib/validations/jml/task";

export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listTasks(actor, params.id!)))),
  { id: "jml-tasks-read", limit: 120, windowMs: 60_000 },
);

/** A manual task on one live case (Onboarding §10.5 / Offboarding M-NN). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(await addManualTask(actor, params.id!, await body(req, manualTaskSchema))),
    ),
  ),
  { id: "jml-tasks-write", limit: 60, windowMs: 60_000 },
);
