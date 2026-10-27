import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { canErase } from "@/lib/hiring/access";
import { dsarExport } from "@/lib/hiring/dsar";
import { eraseCandidate } from "@/lib/hiring/erasure";
import { hiringRoute } from "@/lib/hiring/route";

export const dynamic = "force-dynamic";

/**
 * Data-subject requests for one candidate (Interview Hub `/api/candidates/[id]/dsar`).
 * GET exports everything held; DELETE erases it in full (D6). Both need the
 * org-wide `hiring.erase` permission.
 */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      if (!canErase(actor)) return forbidden();
      const { id } = await params;
      const res = ok(await dsarExport(id));
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("Content-Disposition", `attachment; filename="candidate-${id}.json"`);
      return res;
    }),
  ),
  { id: "hiring-dsar", limit: 10, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      if (!canErase(actor)) return forbidden();
      const { id } = await params;
      const erased = await eraseCandidate(id, actor.userId);
      return ok({ id, erased, alreadyErased: !erased });
    }),
  ),
  { id: "hiring-dsar", limit: 10, windowMs: 60_000 },
);
