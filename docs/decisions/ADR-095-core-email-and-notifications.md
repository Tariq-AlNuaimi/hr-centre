# ADR-095 — One email log, one template store, one logged sender; a notification registry with preferences

**Status:** Accepted — operator-approved P2 platform roadmap (item 2)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

JML had an email queue/log (`JmlEmailLog`) and template overrides
(`JmlEmailTemplateOverride`); HR tickets had `HiveEmailTemplate` and sent without a log;
Performance sent ladder emails without a log. Notification kinds were one enum with no
statement of which module owns a kind or whether a person may turn it off (audit:
`ux/shell-people.md` R15, R20).

## Decision

1. **Email log:** `jml_email_logs` becomes `core_email_logs` **in place** (rename keeps
   every row and resend link) with `module` (existing rows `jml`) and a soft
   `subject_type`/`subject_id`. JML keeps its typed `case_id`. The model is `EmailLog`,
   its status enum `EmailStatus` (Postgres type name unchanged). JML's drain and failure
   alerts read only `module = 'jml'`.
2. **One logged sender:** `lib/core/email/send.ts` `sendLoggedEmail` = the single
   transport (`lib/email.ts`, unchanged) + a log row (metadata only, never the body).
   Used by ticket answers, ticket notifications and the Performance ladder. JML's queue
   writes the same log. Behaviour is the transport's (`sent: false` when SMTP is unset,
   errors re-thrown).
3. **Templates:** `core_email_templates(module, key)` holds overrides of a module's
   default wording (subject / body / cc; no row = default). JML overrides and the ticket
   answer template are copied in; their services keep their contracts. The ticket
   template no longer needs a seed (no row = default), which removes the soft-delete
   tombstone trap the legacy table had.
4. **Notifications:** `lib/core/notify/registry.ts` registers every `NotificationKind`
   with its module, whether it has its own email, and whether it is mandatory
   (escalations, statutory deadlines, failed sends). `core_notification_preferences`
   holds a person's per-kind in-app / email choice; the one writer
   (`persistNotifications`) drops muted in-app notices (fail-open), and ticket emails
   skip people who turned that email off. Edited on Settings › Profile.

## Considered options

- **A transactional email service with templates and logs (Postmark, SendGrid
  dynamic templates, Resend)** — rejected for now: SMTP is the deployment's transport,
  and template text must be HR-editable and audited in our database. The logged sender
  is the seam a provider would plug into.
- **Novu / Knock for notification preferences** — rejected: an external system of
  record for who was told what; our feed and dedupe already live in Postgres.
- **A new core log table with a copy** — rejected in favour of an in-place rename: same
  result, no window where the queue is split.

## Consequences

- The legacy template tables are dropped once the new path is verified live.
- An admin page listing the core email log across modules is deferred; JML's per-case
  email tab reads the same log. **Done in ADR-103** (Admin › Logs › Email log).
