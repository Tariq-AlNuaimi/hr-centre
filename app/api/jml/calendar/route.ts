import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { calendarTotals, joiningCalendar } from "@/lib/jml/watch/calendar";
import { calendarSchema } from "@/lib/validations/jml/case";

/** Joining dates in a range, with the range totals (§12). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const { entries, truncated } = await joiningCalendar(actor, query(req, calendarSchema));
      return ok({ entries, truncated, totals: calendarTotals(entries) });
    }),
  ),
  { id: "jml-calendar-read", limit: 60, windowMs: 60_000 },
);
