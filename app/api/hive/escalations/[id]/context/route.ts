import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok } from "@/lib/api-response";
import { ticketReach } from "@/lib/hive/services/permissions";
import { ticketContext } from "@/lib/hive/services/ticket-context";
import { prisma } from "@/lib/prisma";

/**
 * The ticket's employee context rail (UX P1 tickets P1-3). Exactly the
 * ticket's own read gate: See tickets reads any ticket, a Drafter/Approver
 * only their pairs' tickets (404 otherwise).
 */
export const GET = withRateLimit(
  withAuth(async (_req, ctx) => {
    const reach = await ticketReach(ctx.session.user.id);
    if (!reach) return forbidden();
    const { id } = await ctx.params;
    const row = await prisma.escalation.findUnique({
      where: { id },
      select: { id: true, hrPairId: true, employeeId: true, employeeEmail: true },
    });
    if (!row || (reach !== "all" && !reach.includes(row.hrPairId))) return err("Not found.", 404);
    return ok(await ticketContext(row, reach));
  }),
  { id: "hive-ticket-context", limit: 120, windowMs: 60_000 },
);
