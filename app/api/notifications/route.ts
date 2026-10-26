import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { NOTIFICATION_PAGE_SIZE } from "@/lib/pms/notifications";

/**
 * The feed behind the header bell — §5.5's escalation ladder, read by a human.
 *
 * ASSIGNMENT IS THE FILTER, AND IT IS THE SERVER'S. There is no id parameter
 * and no way to ask for someone else's feed: the `where` is built from the
 * session's own `employeeId` and nothing in the request can widen it. That is
 * the same shape §4.4's `scope=mine` takes on the roster, for the same reason —
 * a notification names who missed what, which is exactly the kind of thing a
 * curious colleague should not be able to page through.
 *
 * A signed-in user with NO employee record (ADR-065 keeps login identity and
 * org record separate — a platform admin may never appear in the HR data) gets
 * an empty feed and a zero badge, which is the same answer §4.4's My Tasks
 * gives them. Not an error; the resting state of an unlinked account.
 */

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.employeeId) return ok({ items: [], unread: 0 });

    // JML S2 — a row queued outside the working window (`sendAfter` in the
    // future) is not shown yet, and a dismissed one is gone from the feed.
    const now = new Date();
    const where = {
      recipientEmployeeId: actor.employeeId,
      dismissedAt: null,
      OR: [{ sendAfter: null }, { sendAfter: { lte: now } }],
    };

    // Two reads rather than one: the badge counts EVERY unread, while the list
    // is one bounded page. Deriving the count from the page would understate it
    // the moment someone has more than a page of unread — and a badge that
    // silently caps at 20 is a badge that lies on exactly the busy morning it
    // matters most.
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        take: NOTIFICATION_PAGE_SIZE,
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          body: true,
          href: true,
          readAt: true,
          createdAt: true,
          caseId: true,
        },
      }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    return ok({ items, unread });
  }),
  { id: "notifications-list", limit: 120, windowMs: 60_000 },
);
