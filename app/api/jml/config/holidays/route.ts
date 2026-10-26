import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { addHoliday, listHolidays } from "@/lib/jml/config";
import { body, jml, query, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { holidaySchema } from "@/lib/validations/jml/config";

const yearSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()),
});

/** Public holidays — non-working days for every due date and working-day count. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      return ok(await listHolidays(query(req, yearSchema).year));
    }),
  ),
  { id: "jml-holidays-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      const input = await body(req, holidaySchema);
      return created(await addHoliday(input.date, input.name));
    }),
  ),
  { id: "jml-holidays-write", limit: 30, windowMs: 60_000 },
);
