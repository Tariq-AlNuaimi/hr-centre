import type { NextRequest } from "next/server";
import { ok, err, forbidden, created, readJsonBody } from "@/lib/api-response";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { requireHivePermission, ticketReach } from "@/lib/hive/services/permissions";
import { raiseTicketForEmployee } from "@/lib/hive/services/escalation-raise";
import { raiseForEmployeeSchema } from "@/lib/validations/hive/escalation";
import { listEscalations, listQueuePairs } from "@/lib/hive/services/escalation-queue";
import { escalationQuerySchema } from "@/lib/validations/hive/escalation-queue";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";

/**
 * §5.4's queue (AC-10.1).
 *
 * Gated on See tickets (ADR-073). §5.3 gives the HR accounts one shared,
 * company-wide queue; US-T6's filters (pair, source, dates, search) narrow it
 * only when the reader asks, and each page carries live per-status counts.
 *
 * QA D-03: a Drafter/Approver without See tickets reads the queue limited to
 * the pairs they can act on (`ticketReach`), instead of a 403.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const reach = await ticketReach(ctx.session.user.id);
  if (!reach) return forbidden();
  const pairIds = reach === "all" ? undefined : reach;
  const url = new URL(req.url);
  const param = (k: string) => url.searchParams.get(k) ?? undefined;
  const parsed = escalationQuerySchema.safeParse({
    status: param("status"),
    cursor: param("cursor"),
    pairId: param("pairId"),
    source: param("source"),
    from: param("from"),
    to: param("to"),
    q: param("q"),
    view: param("view"),
    assigneeId: param("assigneeId"),
  });
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid filter.", 400);

  // The pair list rides the first page only: it feeds the filter control,
  // and "show older" has no use for it.
  const [{ data, nextCursor, counts }, pairs, settings] = await Promise.all([
    listEscalations({ ...parsed.data, pairIds, userId: ctx.session.user.id }),
    parsed.data.cursor ? Promise.resolve(undefined) : listQueuePairs(pairIds),
    getTicketSettings(),
  ]);
  return ok({ data, nextCursor, counts, pairs, settings, total: data.length });
});

/**
 * HR raises a ticket on an employee's behalf. Needs Draft on at least one pair;
 * the ticket then routes like any other (it may land with a different pair) and
 * goes through the same approval — the raiser gains nothing on it.
 */
export const POST = withRateLimit(
  withAuth(
    requireHivePermission("draftEscalation", async (req: NextRequest, ctx) => {
      const parsed = raiseForEmployeeSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid ticket.", 400);
      const result = await raiseTicketForEmployee(
        { userId: ctx.session.user.id, name: ctx.session.user.name ?? null },
        parsed.data,
      );
      if (!result.ok) return err(result.error, result.status);
      return created({ id: result.ticket.id, ticketNumber: result.ticket.ticketNumber });
    }),
  ),
  { id: "hive-raise-ticket", limit: 20, windowMs: 60_000 },
);
