# Blueprint — HR tickets (the HIVE port)

Scope: lib/hive/**, lib/validations/hive/**, app/api/hive/**, app/api/mcp/route.ts, app/[locale]/(dashboard)/hive/**, app/[locale]/(hive)/reply/**, components/hive/**, prisma/seed-hive.ts, scripts/hive-import-providers.mjs, tests/contracts/hive-*.test.ts, lib/rbac/catalogue.ts, lib/rbac/guards.ts, lib/rbac/service.ts, lib/validations/rbac.ts, components/rbac/**, app/api/users/[id]/route.ts, i18n/route-decision.ts, eslint-rules/rules/no-bare-api-route.mjs, components/layout/AppSidebar.tsx, components/people/RecordTabs.tsx, app/[locale]/(dashboard)/people/[id]/page.tsx, components/dashboard/**

Status: AUTHORISED by the operator's port brief (2026-10-26, "port HIVE into HR Centre to the
smallest detail"; HIVE source `/home/user/hive` at `fd3fa10`). Governing HIVE decisions carried
over: ADR-070 (reply links), ADR-073 (pair-scoped access — now on the role builder), ADR-074/075
(the MCP server for Siraaj; Siraaj is the front door, HR Centre the back office), ADR-076 (platform
look v0.2). HR Centre decision record: `docs/decisions/ADR-079-hr-tickets-hive-port.md`.

## Problem & outcome

Employees ask HR questions in **Siraaj**. Siraaj calls HIVE's MCP server, whose six `hive_*` tools
answer HR data questions (HR Tag, office rotation, discounts, network providers, org chart) and
open tickets (`hive_open_ticket`, the only way a ticket is created). HR work tickets to an approved,
emailed answer. HIVE is a separate app with its own users, org tables and permission grid.

**Outcome:** the whole of HIVE lives inside HR Centre as the **HR tickets** module, on HR Centre's
logins, org and role builder — Siraaj keeps calling the same `POST /api/mcp` with the same tool
names and schemas, employees keep the same `/reply/<token>` page, and HR keep the same queue,
approval rule and emails.

## Market scan

Ticketing with mandatory approval is the norm in HR service delivery tools — **ServiceNow HRSD**
(cases routed by HR service + COE, approval rules, response templates), **Zendesk / Freshservice
for HR** (groups, macros, SLAs, public reply links), **Workday Help** (case types routed by
worker's org). HIVE's distinctive choices, kept: routing by an HR Tag pair that spans companies
(no org scope can express it), approval required for EVERY answer with no self-approval, reply by
a hashed, revocable link rather than mail ingestion, and no SLA wording to employees. Anti-feature
kept out: auto-sending AI-drafted answers.

## Architecture (where HIVE's pieces land)

| HIVE                                          | HR Centre                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hive_*` tables (tickets, pairs, rotation, …) | same table names; models renamed only on clash (`EmailTemplate` → `HiveEmailTemplate`)                                                                                                     |
| `Company` / `OrgUnit`                         | **not ported** — core `OrgEntity` / `Directorate` / `Department` / `Team`; leaders + order in module-owned `hive_org_unit_info`                                                            |
| Coverage `companyId` / `orgUnitId`            | `entityId` + `companyWide` (company-wide routing kept a separate flag) + soft links `directorateId` / `departmentId`                                                                       |
| `HrPermissionGrant` (6 perms × 3 scopes)      | catalogue `tickets.see/draft/approve/editContent/configure/viewReports`; scopes GROUP / HR_PAIR / OWN_HR_PAIR on assignments; cover = `validFrom/validUntil` (≤ 180 days)                  |
| MANAGE_ACCOUNTS (an HR grant)                 | **dropped** — only platform admins manage roles and assignments (operator decision)                                                                                                        |
| Last approver / last manager invariant        | `lib/rbac/guards.ts`: a permanent group-wide `tickets.approve` holder must remain (role edit/delete, assignment removal, login disable, user delete); "last manager" = last platform admin |
| `/en/hive/escalations/<id>`                   | same path in HR Centre (`/[locale]/hive/escalations/[id]`)                                                                                                                                 |
| `/reply/<token>` page, reply API              | page path unchanged; API `POST /api/hive/reply/[token]`                                                                                                                                    |
| `POST /api/mcp`                               | same path, same six tools, same names/descriptions/schemas; bearer `HIVE_MCP_TOKEN`                                                                                                        |
| `Escalation.employeeEmail`                    | kept as an immutable snapshot + new nullable `employeeId → Employee` (linked on create by email)                                                                                           |

Module code: `lib/hive/**` (pure rules + tools + MCP), `lib/hive/services/**` (Prisma services),
`lib/validations/hive/**`, routes under `app/api/hive/**` (+ `/api/mcp`), pages under
`app/[locale]/(dashboard)/hive/**` and `app/[locale]/(hive)/reply/[token]`.

## User stories & acceptance criteria

**US-H1 Access on the role builder.** As a platform admin, I give HR people exactly HIVE's powers.

- AC-H1.1 The role builder lists an "HR tickets" module with six actions; four starter roles
  (Ticket viewer, Ticket drafter, Ticket approver, Tickets admin) are seeded.
- AC-H1.2 An assignment may be scoped to the whole group, one HR pair, or "own HR pair"; draft and
  approve honour it; the other ticket actions count only at group scope.
- AC-H1.3 OWN_HR_PAIR covers the pair of the HR Tag member linked to the login; no link → nothing.
- AC-H1.4 A cover assignment (validUntil) grants only inside its window, at most 180 days.
- AC-H1.5 Removing the last permanent group-wide approver (any path) is refused with a sentence.

**US-H2 Ticket intake (Siraaj).** `hive_open_ticket` creates a ticket exactly as HIVE: dedupe 30
min on email+question, 3/hour per email, 30/hour unverified Siraaj ceiling, routing (company-wide →
directorate → selector → default), OPENED event, routing audit row, "opened" notification; the
ticket links to the Employee with that email; identity verified only via `X-Siraaj-User-Email`.

**US-H3 Queue and detail.** As HR with `tickets.see`, I see the company-wide queue (filters: status
chips with live counts, pair, source, from/to Muscat days, search by any prefix/number, name,
email, question; 50 per page with a cursor) and a ticket's detail (question, conversation, history).

**US-H4 Drafting and approval.** Draft (pair-scoped) → submit → approve & send (pair-scoped, never
own draft unless retry) or return with a note; retry a failed send; stale 10-minute claim takeover;
close (approver any status; drafter only SENT); reply links revoked on close; every transition is
one conditional update + an event in one transaction.

**US-H5 Employee follow-up.** The answer email carries a 30-day reply link; the public page shows
the thread (answer only when SENT); up to 5 follow-ups, each reopening the ticket; every failure is
the same 404; rate-limited per IP and per token; a signed-in HR user opening the link is not bounced.

**US-H6 HR notifications.** Opened (pair + own-pair drafters; group drafters not — HIVE quirk kept),
reopened (+ current drafter), submitted (approvers covering the pair minus the drafter), sent (the
drafter); 200-character preview; flood backstop (> 20 tickets/hour for a pair skips opened/reopened);
link to the HR Centre ticket page; errors swallowed.

**US-H7 Content.** With `tickets.editContent`: edit the answer email (subject/body, `{{answer}}`
required, reset rewrites the default) and ticket settings (prefix, status labels).

**US-H8 Reports.** With `tickets.viewReports`: counts-only report over Muscat days (≤ 366), daily ≤ 92
days else weekly; tiles, median hours to answer, by status/source/pair, volume.

**US-H9 Reference data.** With `tickets.configure`: CRUD for HR pairs and members (member ↔ login
link by email), coverage, rotation (config, groups, coverage), discounts, providers (+ the Excel
import script), org-chart details.

**US-H10 In HR Centre.** An "HR tickets" sidebar group; an "HR tickets" tab on an employee record
(gated by `tickets.see`); waiting tickets on My tasks.

## Scenarios

**Happy path.** Siraaj: employee asks about carry-over → `hive_open_ticket` → HR-0047 routed to
Rahma & Mohammed → both get "New HR ticket" → Rahma drafts, submits → Mohammed approves → employee
gets the answer with a reply link → follows up → ticket reopens → Rahma edits, resubmits → sent →
closed, link revoked.

**Worst paths.**

- A drafter tries to approve their own draft → 403 `self_approval`.
- An approver for pair A opens pair B's ticket → sees it (company-wide view) but every action is
  refused; asking about a ticket id while holding no approve anywhere → forbidden before the read.
- Two approvers press Approve together → one email.
- SMTP unset → SEND_FAILED with "Email is not configured", resumable by Retry.
- A reply link after close, after 30 days, malformed or a 6th follow-up → the same 404.
- `HIVE_MCP_TOKEN` unset → `/api/mcp` answers 503; wrong token → 401.
- A platform admin removes the last permanent group approver's role → refused.

## Five Pillars

- **Speed:** RSC pages for read views; one grants query per request; queue page bounded (51 rows).
- **Secure:** every route `withAuth`/`withAdminAuth` + zod, public routes rate-limited, token hashes
  only, constant-time bearer, no PII in reports/notifications logs, audit on every model.
- **Maintainable:** HIVE's pure rule modules ported verbatim; one permissions bridge on lib/rbac.
- **Scalable:** every list bounded (`take`), groupBy for counts, no N+1 (batched lookups).
- **High-quality:** honest empty/loading/error states; refusals are sentences.

## Delivery slices

1. Data model, permissions on the role builder, starter roles, seed of real config.
2. Queue, detail, draft/submit/return/approve/send/retry/close, events, notifications, email
   template, settings, sidebar entry.
3. Public surfaces: reply page + API, `/api/mcp` + the six tools.
4. Reports, admin screens (pairs, coverage, rotation, discounts, providers, org details), import.
5. Employee-record tab, My tasks, polish.

## Open questions (carried from HIVE; proceed on defaults)

- OQ-S1: does Siraaj send `X-Siraaj-User-Email`? Default: optional, verified when present.
- Linking unverified tickets to an Employee: default — linked, and labelled "unverified" wherever shown.
- Ticket numbering restarts at 1001 so no HIVE-xxxx an employee holds from the old app repeats.

## Build notes

Each slice appends its notes here.

- **Slice 1.** `ScopeType` gains HR_PAIR / OWN_HR_PAIR (resolvers in `lib/hive/pair-scope.ts`).
  HR Super Admin's starter definition is pinned to the foundation modules so adding a module never
  widens it. Coverage keeps company scoping on the row (`entityId`) so routing works before HR
  loads the org into HR Centre.
- **Slice 2.** Queue, detail, draft/submit/return/approve/retry/close, history, notifications,
  answer-email editor and ticket settings ported from HIVE with their tests. Routes moved under
  `/api/hive/escalations/**`; pages keep `/hive/escalations/[id]` (the notification link).
  Notification recipients come from `usersHoldingPermission` (group/HR_PAIR holders) plus
  OWN_HR_PAIR holders whose member link is in the pair; "opened" drops group-wide drafters (HIVE
  quirk, kept). Transactions use `auditedTransaction` (ADR-068). Sidebar group "HR tickets":
  Tickets (see), Ticket reports (viewReports — HIVE hid its nav from reports-only users; here
  reports has its own entry), Ticket setup (editContent or configure). `server-only` is not a
  dependency here, so the ported modules drop that import (the no-prisma-in-client rule holds the
  line instead).
- **Slice 3.** MCP + reply links live; tools read the core org + `hive_org_unit_info`; the
  rotation tool reads `hive_rotation_config`. A department whose directorate was retired shows at
  the org chart's top level (HIVE answered `no_chart` for such orphans; in core org they are real
  departments with people).
- **Slice 4.** Reports + the reference-data screens HIVE never had; provider upload on the screen
  as well as `npm run hive:providers`. Fixed: read-excel-file v9 returns the workbook (HIVE's
  script read every real file as empty).
- **Slice 5.** Home "HR tickets" tasks, the employee record tab (gated on `tickets.see`) and the
  asker/identity/record link on the ticket.
- **Cut-over:** `docs/runbooks/hive-siraaj-cutover.md`.
