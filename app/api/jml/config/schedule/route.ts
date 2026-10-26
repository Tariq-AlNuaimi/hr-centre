import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { getSchedule, saveSchedule } from "@/lib/jml/config";
import { body, jml, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { scheduleSchema } from "@/lib/validations/jml/config";

/** The ONE working calendar's weekly schedule (ADR-077). Edits affect future due dates only. */
export const GET = withRateLimit(
  withAuth(jml(async ({ actor }) => (requireAnywhere(actor, "jml.view"), ok(await getSchedule())))),
  { id: "jml-schedule-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await saveSchedule(await body(req, scheduleSchema)));
    }),
  ),
  { id: "jml-schedule-write", limit: 30, windowMs: 60_000 },
);
