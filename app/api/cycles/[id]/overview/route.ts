import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, notFound, ok } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";
import { canRunCycle } from "@/lib/pms/cycle";
import { cycleOverview } from "@/lib/pms/cycle-overview";

/**
 * A cycle's console (docs/blueprints/ux-p1-performance.md): stage timeline,
 * completion and late counts, setup checklist. Org-wide counts, so only for
 * who may run the cycle (§4.1 — HR Super Admin or HRBP).
 */
export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const actor = await resolveActor(session);
    if (!canRunCycle(actor)) return forbidden();
    const { id } = await params;
    const overview = await cycleOverview(id);
    return overview ? ok(overview) : notFound("Cycle");
  }),
  { id: "pms-cycle-read", limit: 120, windowMs: 60_000 },
);
