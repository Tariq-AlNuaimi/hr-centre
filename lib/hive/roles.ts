import type { Permission } from "@/lib/rbac/catalogue";

/**
 * HR tickets' starter roles (HIVE port). Pure data, seeded idempotently by
 * `prisma/seed-hive.ts` (created only if no role carries the key — a deleted or
 * edited starter stays as the admin left it).
 *
 * HIVE gave each person a row of six grants, and Draft / Approve carried their
 * own scope. A role here is a bundle and the SCOPE lives on the assignment, so
 * the pair-scoped actions are their own roles: give "Ticket drafter" for the
 * person's own pair (OWN_HR_PAIR), one pair (HR_PAIR, e.g. cover) or every pair
 * (whole group). HIVE's seeded HR accounts map to:
 *
 *   Alaa      Ticket viewer · Ticket drafter (own pair) · Tickets admin
 *   Muna      Ticket viewer · Ticket drafter (group) · Ticket approver (group) · Tickets admin
 *   Siham, Shahed, Rahma   Ticket viewer · Ticket drafter (own) · Ticket approver (own)
 *   Afra, Mohammed         Ticket viewer · Ticket drafter (own)
 *
 * (HIVE's "Manage accounts" is not a ticket action any more: only platform
 * admins manage roles and assignments in HR Centre.)
 */

export type TicketStarterKey =
  "TICKETS_VIEWER" | "TICKETS_DRAFTER" | "TICKETS_APPROVER" | "TICKETS_ADMIN";

export const TICKET_STARTER_ROLES: ReadonlyArray<{
  key: TicketStarterKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}> = [
  {
    key: "TICKETS_VIEWER",
    name: "Ticket viewer",
    description: "Sees the whole HR ticket queue and the ticket reports. Give for the whole group.",
    permissions: ["tickets.see", "tickets.viewReports"],
  },
  {
    key: "TICKETS_DRAFTER",
    name: "Ticket drafter",
    description:
      "Drafts answers and submits them for approval. Give for their own HR pair, one pair or every pair.",
    permissions: ["tickets.draft"],
  },
  {
    key: "TICKETS_APPROVER",
    name: "Ticket approver",
    description:
      "Approves and sends answers drafted by someone else. Give for their own HR pair, one pair or every pair.",
    permissions: ["tickets.approve"],
  },
  {
    key: "TICKETS_ADMIN",
    name: "Tickets admin",
    description:
      "Edits the answer email, ticket settings, HR pairs, coverage, rotation, discounts and providers. Give for the whole group.",
    permissions: ["tickets.see", "tickets.editContent", "tickets.configure", "tickets.viewReports"],
  },
];
