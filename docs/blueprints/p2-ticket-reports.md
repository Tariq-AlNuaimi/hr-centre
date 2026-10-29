# P2 — Ticket reports: service levels, backlog, load, export, click-through

Scope: lib/hive/services/report-sla.ts, lib/hive/services/reports.ts, lib/hive/services/escalation-read.ts, lib/validations/hive/escalation-queue.ts, app/api/hive/admin/reports/export/route.ts, app/api/hive/escalations/route.ts, app/[locale]/(dashboard)/tickets/reports/page.tsx, app/[locale]/(dashboard)/tickets/(queue)/page.tsx, components/hive/reports/**, tests/contracts/hive-reports.test.ts, messages/**, tests/contracts/p2-ticket-reports.test.ts

Status: operator-approved P2 roadmap (2026-10-29). Source: UX audit `tickets-hiring.md` P2-10.
Benchmarks: Zendesk Explore / Freshdesk helpdesk reports (first response vs resolution vs SLA
target, backlog, per-agent load, CSV export, drill-down to the ticket view).

## Stories and acceptance criteria

- **US-1 (HR lead) service levels.** AC-1.1 Reports show, for tickets answered in the range: median
  time to first response, median time to the answer being sent, the share answered by the answer-by
  target (with on time / late / no target counts), and the median approval turnaround (submitted →
  approved).
- **US-2 (HR lead) backlog trend.** AC-2.1 A bar per period (day or week, as the volume chart) of
  tickets still open at the end of it.
- **US-3 (HR lead) ageing.** AC-3.1 Today's open tickets by age: 0–2, 3–7, 8–14, 15+ days, with a
  link to the overdue queue.
- **US-4 (HR lead) per-person load.** AC-4.1 Per person: open and overdue tickets assigned now,
  answers drafted in the range; the name opens the queue filtered to that person.
- **US-5 (HR lead) export.** AC-5.1 "Export CSV" downloads one row per ticket opened in the range
  (≤ 5,000): ticket id, status, source, pair, assignee, timestamps and hours, on time. No employee
  name, email or question text. Formula characters are neutralised. Same permission as the report
  (`viewReports`), rate-limited.
- **US-6 (HR lead) click-through.** AC-6.1 Pair and status rows open the queue filtered to that pair
  or status and the report's range; the queue reads `status`, `pairId`, `assigneeId`, `view`,
  `from`, `to` from its URL once, then its own controls take over.

## Worst paths

- No answered tickets → "—" for medians and the on-time share, never 0%.
- 366-day range → weekly buckets; backlog reads at most 20,000 rows (bounded).
- A forged `assigneeId` → the queue simply shows nothing; reach rules (pairs) still apply.

## Data

None new. Reads `hive_escalations` (`first_response_at`, `due_at`, `submittedAt`, `approvedAt`,
`sentAt`, `assignee_id`, `draftedById`).
