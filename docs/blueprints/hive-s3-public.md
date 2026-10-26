# Blueprint — HR tickets slice 3: reply links and the MCP server for Siraaj

Scope: app/api/mcp/route.ts, app/api/hive/reply/**, app/[locale]/(hive)/**, lib/hive/mcp/**, lib/hive/tools/**, lib/hive/civil.ts, lib/hive/rotation.ts, lib/hive/hrtag-routing.ts, lib/hive/hrtag-source.ts, lib/hive/services/escalation.ts, lib/hive/services/reply.ts, lib/validations/hive/**, components/hive/reply/**, components/hive/HiveLogo.tsx, i18n/route-decision.ts, eslint-rules/rules/no-bare-api-route.mjs, app/tokens.css, app/globals.css, SECURITY.md

Status: part of `docs/blueprints/hive.md` (slice 3). Stories US-H2 and US-H5. Public paths and
the new env var are on the Ask-before list; authorised by the operator's port brief (cites HIVE
ADR-070, 074, 075).

## What this slice delivers

- `POST /api/mcp` (exact path): stateless JSON-RPC 2.0, the six `hive_*` tools with HIVE's names,
  descriptions and input schemas verbatim; bearer `HIVE_MCP_TOKEN` (503 unset, 401 wrong);
  `X-Siraaj-User-Email` overrides the ticket email and sets `identityVerified` (bad header → 400);
  GET → 405. Notifications → 202.
- Tools re-wired to HR Centre: companies and the org chart read the core org (OrgEntity →
  Directorate → Department → Team) plus `hive_org_unit_info` (leaders, order); HR Tag routing and
  rotation read their own coverage tables (labels/aliases owned there, company scoping on the
  row). The rotation tool reads `hive_rotation_config` (falls back to HIVE's constants).
- `hive_open_ticket` → `createEscalation`: dedupe, caps, routing, OPENED event, routing audit,
  "opened" notification, and the new `employeeId` link by email.
- `/reply/<token>` (public page, no chrome, not bounced for signed-in users) and
  `POST /api/hive/reply/[token]` (follow-ups, ≤ 5, each reopens).

## Worst paths checked

Token unset (503), wrong token (401), batch / unknown method / inherited tool name (JSON-RPC
errors), malformed identity header (400), invalid/expired/revoked/closed/6th follow-up on a reply
link (one 404), a signed-in HR user on `/reply/…` (rendered, not redirected).
