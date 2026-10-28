import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/jml/access";
import { myTasks } from "@/lib/jml/dashboard";
import { JmlError } from "@/lib/jml/errors";
import { workerFacts, workerTaskWhere } from "@/lib/jml/routing/worker";
import { jml, query } from "@/lib/jml/route";
import { myTasksQuerySchema } from "@/lib/validations/jml/case";

/**
 * The signed-in user's open JML tasks, overdue first — HR's own, plus the
 * desk and line-manager tasks routed to them (task routing; derived authority,
 * no role needed). Anyone with neither gets 403.
 */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      if (!holdsAnywhere(actor, "jml.workTasks") && !workerTaskWhere(await workerFacts(actor))) {
        throw new JmlError("You do not have permission to do that.", 403);
      }
      return ok(await myTasks(actor, query(req, myTasksQuerySchema).caseType));
    }),
  ),
  { id: "jml-my-tasks", limit: 120, windowMs: 60_000 },
);
