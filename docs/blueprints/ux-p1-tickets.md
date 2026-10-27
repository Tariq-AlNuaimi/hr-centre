# UX review P1 — phase 8: HR tickets with an owner, a clock and context

Scope: lib/hive/**, lib/working-time/calendar.ts, lib/validations/hive/**, app/api/hive/**, app/[locale]/(dashboard)/tickets/**, components/hive/**, prisma/schema.prisma, prisma/migrations/**

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1"; migrations authorised.
Source: UX review tickets/hiring P1-2, P1-3, P1-4, P1-5 and the ticket half of P1-11.
Re-verified on `main` at fa1de7a.

## Why

Nobody owns a ticket (a pair receives it; "claim" is a 10-minute lock). There is no answer-by
time, no ageing, no "mine" view. The detail page has no employee context and a muddled action
zone with Close beside Save. No saved replies. Setup mixes ticket routing with Siraaj's knowledge
and repeats the working screens. The queue is a hand-rolled table that runs off the page.

## Stories and acceptance criteria

### US-1 — Owner and clock (P1-2)

- AC-1.1 A ticket has an assignee (a User who can draft for its pair), an internal answer-by time
  and a first-response time (migration `ux_p1_ticket_sla`; nullable; FK indexed).
- AC-1.2 A new ticket's answer-by time is `responseHours` (setting, default 16 = two working days)
  of WORKING time after it was raised, on the core calendar (Sun–Thu 08:00–17:00 Muscat, public
  holidays excluded — `addWorkingHours`). Computing it never blocks raising a ticket (null on
  failure). Never shown to employees.
- AC-1.3 Assigning: whoever may draft for the pair assigns to anyone who may draft for it, or
  clears it (`PUT /api/hive/escalations/<id>/assignee`); refusals: 403 / 422.
- AC-1.4 Queue views All · Mine · Unassigned · Overdue (server-side; only tickets that still need
  HR; oldest due first) and an ageing badge per row: On time / Due soon (≤ 4 h) / Overdue.

### US-2 — Detail page (P1-3)

- AC-2.1 Two columns: question, follow-ups, answer and history on the left; on the right
  ownership (assignee picker, answer-by badge, who can approve — named) and "Who is asking"
  (record link, job · department · company, manager, grade, tenure, open joiner/mover/leaver case)
  plus their last 5 questions. Internal fields only — no pay, IDs or personal details.
- AC-2.2 ONE primary action by state (Approve and send / Retry send / Submit), Save as the quiet
  companion, "Return to drafter…" as a disclosure, Close behind "More" with what it does.
- AC-2.3 The breadcrumb ends on the ticket id.

### US-3 — Saved replies and reference (P1-4)

- AC-3.1 Saved replies (shared or per pair) managed under Ticket settings by Edit content holders;
  an "Insert" menu on the draft appends a saved reply or a reference snippet (current discount
  partners, the data Siraaj answers from). Inserting never sends anything.

### US-4 — Setup split (P1-5) and the queue table (P1-11)

- AC-4.1 The setup hub has two sections: Ticket settings (settings, saved replies, HR pairs,
  access) and Siraaj knowledge (rotation, discounts, providers, org details); the queue and reports
  cards are gone (sidebar and Insights carry them).
- AC-4.2 The queue uses the shared `DataTable`, `FilterBar` and chips with counts; long text
  truncates inside the table instead of pushing the page sideways.

## Deferred

- Org leaders derived from core (P1-5's last clause): core has no unit-head field yet (UX review
  R18, P2); `HiveOrgUnitInfo` stays until that lands.
- Editing `responseHours` on the settings screen (the column exists, default 16).
- Ticket-report additions (first-response vs resolution, backlog) — P2-10.

## Scenarios

- Happy: a ticket raised Thu 16:00 is due Sun 15:00 next week… (16 working hours); Mine shows it
  once Rahma takes it; it turns amber four hours before and red after.
- Worst: assigning to someone outside the pair → 422 "That person cannot draft answers for this HR
  pair."; a drafter of another pair opening the context route → 404.
