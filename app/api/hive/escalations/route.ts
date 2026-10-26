import type { NextRequest } from "next/server";
import { ok, err } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { listEscalations, listQueuePairs } from "@/lib/hive/services/escalation-queue";
import { escalationQuerySchema } from "@/lib/validations/hive/escalation-queue";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";

/**
 * §5.4's queue (AC-10.1).
 *
 * Gated on See tickets (ADR-073). §5.3 gives the HR accounts one shared,
 * company-wide queue; US-T6's filters (pair, source, dates, search) narrow it
 * only when the reader asks, and each page carries live per-status counts.
 */
export const GET = withAuth(
  requireHivePermission("seeTickets", async (req: NextRequest) => {
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
    });
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid filter.", 400);

    // The pair list rides the first page only: it feeds the filter control,
    // and "show older" has no use for it.
    const [{ data, nextCursor, counts }, pairs, settings] = await Promise.all([
      listEscalations(parsed.data),
      parsed.data.cursor ? Promise.resolve(undefined) : listQueuePairs(),
      getTicketSettings(),
    ]);
    return ok({ data, nextCursor, counts, pairs, settings, total: data.length });
  }),
);
