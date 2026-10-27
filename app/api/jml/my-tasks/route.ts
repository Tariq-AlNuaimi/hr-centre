import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { myTasks } from "@/lib/jml/dashboard";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { myTasksQuerySchema } from "@/lib/validations/jml/case";

/** The signed-in user's open JML tasks, overdue first. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.workTasks");
      return ok(await myTasks(actor, query(req, myTasksQuerySchema).caseType));
    }),
  ),
  { id: "jml-my-tasks", limit: 120, windowMs: 60_000 },
);
