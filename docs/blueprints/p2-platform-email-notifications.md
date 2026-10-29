# P2 platform — email log, templates, logged sender, notification preferences (ADR-095)

Scope: lib/core/email/**, lib/core/notify/**, lib/validations/core/notifications.ts, app/api/notifications/preferences/route.ts, components/settings/NotificationPreferences.tsx, app/[locale]/(dashboard)/settings/profile/page.tsx, lib/jml/email/**, lib/jml/sweep.ts, lib/jml/join/retention.ts, lib/hive/services/email-template.ts, lib/hive/services/escalation-send.ts, lib/hive/services/ticket-notify.ts, lib/pms/cycle-notify.ts, prisma/schema.prisma, prisma/migrations/20261029133500_core_email/**, prisma/seed-hive.ts, tests/contracts/core-email-notify.test.ts

Status: operator-approved P2 roadmap, item 2 (email + notifications). Audit: `ux/shell-people.md` R15, R20.
Feature parity: n/a — consolidation; per-kind in-app/email preferences follow the common pattern (Workday, HiBob notification settings).

## Stories and acceptance criteria

- **US-1 (HR) templates still say what we set.** AC-1.1 JML overrides and the ticket answer
  template are copied into `core_email_templates`; their screens read and write it with the
  same rules (JML: clearing every field restores the approved text; tickets: reset restores
  §5.6's wording and editing afterwards works).
- **US-2 (HR / IT) one log.** AC-2.1 Every JML log row survives (in-place rename, ids and
  resend links intact). AC-2.2 Ticket answers, ticket notifications and Performance ladder
  emails are logged (module, type, recipient, subject, outcome — never the body). AC-2.3
  JML's drain never sends another module's row.
- **US-3 (anyone) I choose my notices.** AC-3.1 Settings › Profile lists every kind by
  module with In the app / By email (email only where the kind has its own). AC-3.2
  Mandatory kinds are shown "Always on" and can't be changed (server ignores them too).
  AC-3.3 A muted in-app kind is not written for me; a muted ticket email is not sent to me.
  AC-3.4 A preferences read failure never drops a notice (fail-open).

## Worst paths

- SMTP unset → the logged sender returns `sent: false` and logs FAILED "not configured".
- Transport error → logged FAILED, re-thrown (callers' handling unchanged).
- Log write fails → the send result stands; a warning without details is printed.
- Audit rows for email logs before ADR-095 are named `JmlEmailLog` → retention redacts both names.

## Data

Migration `20261029133500_core_email`: rename `jml_email_logs` → `core_email_logs` (+ module,
subject columns, indexes), create `core_email_templates` (copy JML overrides and live ticket
templates), create `core_notification_preferences` (empty — everyone keeps today's defaults).
Evidence: scratch replay — 2 log rows kept with resend link; 2 templates copied (JML subject +
cc, ticket text), soft-deleted ticket row not copied.
