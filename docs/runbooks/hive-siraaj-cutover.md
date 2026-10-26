# Runbook — moving Siraaj and HR from HIVE to HR Centre's HR tickets

HR tickets (the HIVE port, ADR-079) is live in HR Centre but **dark to Siraaj** until the steps
below. The old HIVE app keeps running until HR cut over; nothing is migrated from it.

## 1. Give HR their access (platform admin)

1. HR Centre → People: make sure each HR person has an employee record and a login (Create login),
   or create the login under Admin → Access.
2. Admin → Roles → Assignments, using the seeded ticket roles (reproduces HIVE's launch grid):

   | Person               | Ticket viewer | Ticket drafter | Ticket approver | Tickets admin |
   | -------------------- | ------------- | -------------- | --------------- | ------------- |
   | Alaa Al Hinai        | Whole group   | Own HR pair    | —               | Whole group   |
   | Muna Adam            | Whole group   | Whole group    | Whole group     | Whole group   |
   | Siham, Shahed, Rahma | Whole group   | Own HR pair    | Own HR pair     | —             |
   | Afra, Mohammed       | Whole group   | Own HR pair    | —               | —             |

   "Own HR pair" works once the login's email equals the member's email under Ticket setup → HR
   pairs (the seed links them on the next deploy; editing the member re-links at once).
   Temporary cover = an assignment scoped to "One HR pair" with a Valid until date (≤ 180 days).
   At least one permanent whole-group Ticket approver must exist (the guards refuse removing the
   last one). HIVE's "Manage accounts" has no equivalent: only platform admins assign roles.

## 2. Check the reference data (Tickets admin)

Ticket setup → HR pairs / Office rotation / Discounts — seeded from HIVE's seed. **Copy any
edits HR made in HIVE's production database** (pairs, coverage, discounts, the answer email,
ticket prefix/labels) — the seed is HIVE's seed, not HIVE's live data. Upload the real provider
spreadsheet under Network providers (nothing is seeded there). Org chart details fill in once the
org is loaded under Admin → Organisation (leaders are applied by name on the next deploy, or
typed on the screen).

## 3. Turn the MCP endpoint on (operator)

1. Generate a token (`openssl rand -base64 32`) — or reuse HIVE's current `HIVE_MCP_TOKEN`.
2. Set it on the Vercel project `hr-centre` as `HIVE_MCP_TOKEN` (Production + Preview, encrypted)
   and redeploy. Until then `POST /api/mcp` answers 503.
3. In Siraaj's admin, change the HIVE MCP server URL to
   `https://hr-centre.vercel.app/api/mcp` (or point DNS `hive.ops-rihal.com` at the HR Centre
   Vercel project and keep the URL) and set the same bearer token. Do not use a redirect: MCP
   clients may not follow a redirect on POST.
4. Smoke test from Siraaj: ask "who is my HR Tag?" (→ `hive_find_hr_tag`) and raise a test
   ticket; it appears in HR tickets → Tickets, numbered from 1001.

## 4. After cut-over

- `AUTH_URL` must be HR Centre's origin so answer emails carry `/reply/<token>` links and HR
  notifications link to `/en/hive/escalations/<id>`. SMTP must be configured, or every approval
  ends in "Send failed".
- Keep the old HIVE app (or a redirect for GET `/reply/*` on `hive.ops-rihal.com`) serving for
  at least **30 days after its last answer email** — its reply links and HR notification links
  point at the old host and only work there.
- Before decommissioning HIVE: export its chat transcripts if wanted (HIVE ADR-075 §5) and run
  `npm run hive:export-siraaj` there if not already done.
