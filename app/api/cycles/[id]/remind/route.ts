import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { canRunCycle } from "@/lib/pms/cycle";
import { remindLate } from "@/lib/pms/cycle-overview";
import { remindLateSchema } from "@/lib/validations/cycle";

/**
 * "Remind late" (docs/blueprints/ux-p1-performance.md): one in-app reminder to
 * each person who owes a step at a stage whose deadline has passed — at most
 * once per person, stage and day. HR (who runs the cycle) only.
 */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const actor = await resolveActor(session);
    if (!canRunCycle(actor)) return forbidden();
    const parsed = remindLateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return err("stageKind must be GOAL_SETTING or YEAR_END");
    const { id } = await params;
    return ok(await remindLate(id, parsed.data.stageKind));
  }),
  { id: "pms-cycle-remind", limit: 10, windowMs: 60_000 },
);
