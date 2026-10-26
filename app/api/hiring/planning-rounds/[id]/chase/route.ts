import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { chaseRound, loadRound } from "@/lib/hiring/planning";
import { hiringRoute } from "@/lib/hiring/route";

/** Record a chase of every department that was asked and never answered (no email is sent). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const round = await loadRound(actor, id, "hiring.manage");
      if (!round) return notFound("Planning cycle");
      return ok(await chaseRound(round));
    }),
  ),
  { id: "hiring-planning-write", limit: 60, windowMs: 60_000 },
);
