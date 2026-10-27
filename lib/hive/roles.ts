import type { Permission } from "@/lib/rbac/catalogue";

/**
 * HR tickets' starter roles (HIVE port). Pure data, seeded idempotently by
 * `prisma/seed-hive.ts` (created only if no role carries the key — a deleted or
 * edited starter stays as the admin left it).
 *
 * HIVE gave each person a row of six grants, and Draft / Approve carried their
 * own scope. A role here is a bundle and the SCOPE lives on the assignment, so
 * the pair-scoped actions are their own roles: give "Ticket Drafter" for the
 * person's own pair (OWN_HR_PAIR), one pair (HR_PAIR, e.g. cover) or every pair
 * (whole group). HIVE's seeded HR accounts map to:
 *
 *   Alaa      Ticket Viewer · Ticket Drafter (own pair) · Tickets Admin
 *   Muna      Ticket Viewer · Ticket Drafter (group) · Ticket Approver (group) · Tickets Admin
 *   Siham, Shahed, Rahma   Ticket Viewer · Ticket Drafter (own) · Ticket Approver (own)
 *   Afra, Mohammed         Ticket Viewer · Ticket Drafter (own)
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
    name: "Ticket Viewer",
    description: "Sees the whole HR ticket queue and the ticket reports. Give for the whole group.",
    permissions: ["tickets.see", "tickets.viewReports"],
  },
  {
    key: "TICKETS_DRAFTER",
    name: "Ticket Drafter",
    description:
      "Drafts answers and submits them for approval. Give for their own HR pair, one pair or every pair.",
    permissions: ["tickets.draft"],
  },
  {
    key: "TICKETS_APPROVER",
    name: "Ticket Approver",
    description:
      "Approves and sends answers drafted by someone else. Give for their own HR pair, one pair or every pair.",
    permissions: ["tickets.approve"],
  },
  {
    key: "TICKETS_ADMIN",
    name: "Tickets Admin",
    description:
      "Edits the answer email, ticket settings, HR pairs, coverage, rotation, discounts and providers. Give for the whole group.",
    permissions: ["tickets.see", "tickets.editContent", "tickets.configure", "tickets.viewReports"],
  },
];
