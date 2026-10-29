import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/core/actor";
import { feedOwnerWhere } from "@/lib/core/notify/store";
import { markReadSchema } from "@/lib/validations/notification";

/**
 * Mark notifications read — either the one that was clicked, or all of them.
 *
 * THE SCOPE IS THE SECURITY. Both branches carry the viewer's own recipient scope in the
 * `where`, so an id belonging to somebody else matches nothing and the response
 * is an honest `{ updated: 0 }` rather than a 403 that would confirm the id
 * exists. There is deliberately no route that takes a recipient.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // An unlinked account (ADR-065) has no feed, so it has nothing to mark.
    // The viewer's own feed: their employee record and their login (US-6).
    const owner = feedOwnerWhere(actor.employeeId, session.user.id);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = markReadSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid request");

    const now = new Date();

    if (parsed.data.all) {
      const where = { AND: [owner, { readAt: null }] };
      // `updateMany` writes no audit row (ADR-010's bulk-write blind spot), so
      // this takes the sanctioned escape hatch: one explicit `recordAudit` for
      // the batch, and a single-line disable. Looping N per-row updates for one
      // "mark all read" click would be N audit rows describing a single human
      // act — a worse trail, not a better one, and unbounded in N.
      const count = await prisma.notification.count({ where });
      // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- audited explicitly below
      const result = await prisma.notification.updateMany({ where, data: { readAt: now } });
      if (result.count > 0) {
        await recordAudit(prisma, {
          entityType: "Notification",
          entityId: actor.employeeId ?? session.user.id,
          action: "UPDATE",
          before: { unread: count },
          after: { unread: 0, markedRead: result.count, readAt: now.toISOString() },
        });
      }
      return ok({ updated: result.count });
    }

    // The clicked-row path. Per-row through the audited client, which is what
    // makes it ordinary: `ids` is capped by the schema, so N is bounded.
    const ids = parsed.data.ids ?? [];
    let updated = 0;
    for (const id of ids) {
      const row = await prisma.notification.findFirst({
        where: { AND: [owner, { id, readAt: null }] },
        select: { id: true },
      });
      if (!row) continue; // someone else's, already read, or gone
      await prisma.notification.update({
        where: { id: row.id },
        data: { readAt: now },
        select: { id: true },
      });
      updated += 1;
    }
    return ok({ updated });
  }),
  { id: "notifications-read", limit: 60, windowMs: 60_000 },
);
