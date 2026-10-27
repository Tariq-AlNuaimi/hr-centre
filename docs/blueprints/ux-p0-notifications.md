# UX review P0 — bell notifications for Hiring and HR tickets (slice D)

Scope: lib/notifications/**, lib/hiring/notify.ts, lib/hive/services/ticket-notify.ts, app/api/notifications/**, prisma/schema.prisma, prisma/migrations/20261027190000_ux_p0_user_notifications/**

Parent contract: `docs/blueprints/ux-p0.md`, US-6. This file pins the data change.

## Stories

- As an approver of a requisition, JD or offer step, I see in the bell that it is my turn.
- As the person who submitted an offer, I see when it is approved, rejected or sent back.
- As a panelist, I see that I owe a scorecard when I am put on an interview panel.
- As a ticket drafter or approver, I see tickets waiting on my pair, and a returned answer.

## Acceptance criteria

- AC-N1 `Notification` has exactly one recipient: `recipient_employee_id` (Performance, JML) or
  `recipient_user_id` (Hiring, HR tickets). A CHECK constraint enforces it; existing rows satisfy it.
- AC-N2 The feed, mark-read and dismiss routes scope to the viewer's employee id OR session user id,
  built from the session only. Someone else's id matches nothing.
- AC-N3 Notices are written after the business action commits, never throw, reach at most 50
  people, and are idempotent per event + recipient (`dedupe_key`).
- AC-N4 No Restricted data: no pay, no ID numbers, no protected attributes; a ticket question at most
  an 80-character preview.

## Scenarios

Happy: an offer is submitted; the HR Manager step's two holders each get "The offer for X is
waiting for your approval (HR manager step)"; one approves; the COO gets the next notice; the
final approval tells the submitter.
Worst: the notification insert fails (FK gone, database hiccup) — the offer is still submitted, a
warning is logged without names, nobody sees a 500.
Worst: a crafted `ids` list in mark-read names another user's notification — `{ updated: 0 }`.

## Data

Migration `20261027190000_ux_p0_user_notifications`: six enum values, two nullable columns
(`recipient_user_id` FK → users ON DELETE CASCADE, `module` varchar(20)), the CHECK, two indexes.
Forward-only and backward compatible for readers that only know employee recipients.
