import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { exitCalendar } from "@/lib/jml/watch/exit-calendar";
import { exitCalendarSchema } from "@/lib/validations/jml/report";

/** Exit dates in a month (AC-15.1/15.2). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const { year, month } = query(req, exitCalendarSchema);
      return ok(await exitCalendar(actor, year, month));
    }),
  ),
  { id: "jml-calendar-read", limit: 60, windowMs: 60_000 },
);
