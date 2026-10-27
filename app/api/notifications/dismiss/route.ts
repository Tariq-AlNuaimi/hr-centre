import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { feedOwnerWhere } from "@/lib/pms/notifications";

const dismissSchema = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * Dismiss one notification from the feed (HR Offboarding's inbox action; JML
 * S2). Dismissing also marks it read. Scoped to the caller's own feed: someone
 * else's id matches nothing and answers `{ updated: 0 }`.
 */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const body = await readJsonBody(request);
    const parsed = dismissSchema.safeParse(body);
    if (!parsed.success) return err("id is required");
    const row = await prisma.notification.findFirst({
      where: {
        AND: [
          feedOwnerWhere(actor.employeeId, session.user.id),
          { id: parsed.data.id, dismissedAt: null },
        ],
      },
      select: { id: true, readAt: true },
    });
    if (!row) return ok({ updated: 0 });
    const now = new Date();
    await prisma.notification.update({
      where: { id: row.id },
      data: { dismissedAt: now, readAt: row.readAt ?? now },
      select: { id: true },
    });
    return ok({ updated: 1 });
  }),
  { id: "notifications-dismiss", limit: 120, windowMs: 60_000 },
);
