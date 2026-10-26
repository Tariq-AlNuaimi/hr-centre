# ADR-079 — HR tickets: HIVE moves into HR Centre on the core org and role builder

**Status:** 🟢 Accepted — operator port brief, 2026-10-26 (Tariq Al-Naaimi).
**Date:** 2026-10-27
**Related:** HIVE ADR-070 (reply links), ADR-073 (pair-scoped grants), ADR-074/075 (MCP server for
Siraaj), ADR-076 (platform look v0.2); HR Centre foundation blueprint §3 (role builder);
`docs/blueprints/hive.md`.

## Context

HIVE (Rihal's HR ticket back office behind Siraaj) is a separate app with its own users, its own
company/org-unit tables and a per-person permission grid (`HrPermissionGrant`: six permissions,
scopes ALL / PAIR / OWN_PAIR, time-boxed cover). HR Centre is Rihal's single HR system and already
has logins, a core org (OrgEntity → Directorate → Department → Team) and a role builder whose scope
kinds are extensible (`registerScopeResolver`).

## Decision

1. **Port HIVE as the `hive` module** with its tables (`hive_*`) and rules intact; HIVE's
   `Company`/`OrgUnit` are not ported — the tools read core org; leader names/titles and display
   order (which core org has no column for) live in module-owned `hive_org_unit_info`.
2. **Permissions become catalogue actions** `tickets.see`, `tickets.draft`, `tickets.approve`,
   `tickets.editContent`, `tickets.configure` (new: the reference-data screens HIVE never had),
   `tickets.viewReports`, granted through roles. Draft/approve honour two new scope kinds,
   `HR_PAIR` (one pair — cover) and `OWN_HR_PAIR` (the holder's member link), added to the core
   `ScopeType` enum; the others count only at Group scope. Cover = assignment `validFrom/validUntil`
   (≤ 180 days, existing rule).
3. **Only platform admins manage roles and assignments** (operator decision). HIVE's
   `MANAGE_ACCOUNTS` grant is dropped, and with it HIVE's "last manager" invariant — its successor
   is the existing "last platform admin" guard.
4. **The last-approver invariant joins the core guards** (`lib/rbac/guards.ts`): no change may
   leave nobody holding a permanent (no window) group-wide `tickets.approve`; checked on role edit
   and deletion, assignment removal, login disable and (new) user delete. Like the other core
   guards it compares holders before/after a simulated change rather than HIVE's Serializable
   re-check — the same concurrency posture as the rest of HR Centre's RBAC.
5. **Coverage keeps company scoping on its own row** (`entityId`, plus a separate `companyWide`
   flag for whole-company routing), with optional soft links (ids, no FK) to core units. Routing
   therefore works before HR has loaded the org into HR Centre, and a unit rename never moves
   routing (HIVE §4.4's three-independent-structures invariant).
6. **The rotation tool reads `hive_rotation_config`** (anchor, type, timezone, weekend) instead of
   code constants, falling back to them when the row is absent; the screen edits it.
7. **Tickets link to core Employee** by email at create (`employeeId`, nullable, SetNull); the
   name/email snapshots stay. Unverified tickets are linked too and labelled unverified wherever the
   link is shown.
8. **Ticket numbers start at 1001** so no number an employee already holds from the still-running
   HIVE app is issued again under the same prefix (no data is migrated).

## Consequences

- HR's seven HIVE accounts must be given HR Centre logins and the ticket starter roles by a platform
  admin (the seed creates no users or assignments).
- The HIVE "opened"-notification quirk (group-wide drafters are not notified) is kept; with roles,
  a person holding BOTH a group and a pair drafter assignment is also not notified for "opened".
- Siraaj keeps its contract: `POST /api/mcp`, the same six tools, bearer `HIVE_MCP_TOKEN` (set by the
  operator; 503 until then).
