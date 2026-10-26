# Blueprint — HR tickets slice 2: queue, drafting, approval, notifications, content

Scope: app/api/hive/escalations/**, app/api/hive/me/**, app/api/hive/admin/email-templates/**, app/api/hive/admin/ticket-settings/**, app/[locale]/(dashboard)/hive/**, lib/hive/services/**, lib/hive/reply-token.ts, components/hive/escalations/**, lib/validations/hive/**, components/hive/**, components/layout/AppSidebar.tsx, components/layout/Breadcrumbs.tsx

Status: part of `docs/blueprints/hive.md` (slice 2). Stories US-H3, US-H4, US-H6, US-H7; scenarios
and pillars are the parent's.

## What this slice delivers

- `GET /api/hive/escalations` (queue: status chips with live counts, pair/source/from/to/search
  filters, 50 per page by cursor) and `GET|PATCH /api/hive/escalations/[id]` (detail + abilities;
  save draft) — `withAuth` + `tickets.see` / `tickets.draft`.
- `POST …/[id]/submit | return | approve | close` — gates inside the services (pair-scoped);
  approve refuses self-approval except a retry; a failed send is 502 and SEND_FAILED.
- `GET /api/hive/me/permissions` — the caller's own ticket actions (chrome only).
- `GET|PUT|DELETE /api/hive/admin/email-templates/escalation-answer`, `GET|PUT
/api/hive/admin/ticket-settings` — `tickets.editContent`.
- Pages `/hive`, `/hive/escalations`, `/hive/escalations/[id]`, `/hive/settings`,
  `/hive/email-template`, each server-gated by a layout (`notFound()` without the action).
- HR notifications via `after()`, recipients from the role builder.

## Worst paths checked

Self-approval (403 sentence), approving without approve anywhere (403 before the ticket is read),
editing a SENT/CLOSED/sending ticket (409), resubmitting the answer already sent (422), two
approvers at once (one claim wins), SMTP unset (SEND_FAILED with a sentence).
