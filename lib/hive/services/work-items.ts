import { PROVIDER_LIMIT, type WorkItem, type WorkProvider } from "@/lib/core/work-items";
import { shortPreview } from "@/lib/core/notify/user-notify";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { ticketTasksFor } from "./my-tasks";
import { getTicketSettings } from "./ticket-settings";

/**
 * HR tickets in Home's "My work" (docs/blueprints/ux-p0.md, US-1): answers to
 * approve and tickets to answer in the viewer's pairs — the same reads as the
 * old home panel (`ticketTasksFor`: pair-scoped, never your own draft to
 * approve), now in the one list. A ticket has no due date (internal SLA is a
 * later item), so these sit under "Later", oldest first.
 */
export const ticketWorkProvider: WorkProvider = {
  module: "tickets",
  async collect(session) {
    const tasks = await ticketTasksFor(session.user.id);
    if (!tasks.canApprove && !tasks.canDraft) return { items: [], total: 0 };
    const { ticketPrefix } = await getTicketSettings();
    const row = (kind: string, r: (typeof tasks.toApprove.rows)[number]): WorkItem => ({
      key: `ticket-${kind}:${r.id}`,
      module: "tickets",
      kind,
      params: {
        id: formatTicketId(r.ticketNumber, ticketPrefix),
        preview: shortPreview(r.question),
        pair: r.hrPair.name,
      },
      dueAt: null,
      href: `/tickets/${r.id}`,
      approval: kind === "ticketApprove",
    });
    const items = [
      ...tasks.toApprove.rows.map((r) => row("ticketApprove", r)),
      ...tasks.toAnswer.rows.map((r) => row("ticketAnswer", r)),
    ];
    return {
      items: items.slice(0, PROVIDER_LIMIT),
      total: tasks.toApprove.count + tasks.toAnswer.count,
    };
  },
};
