# ADR-065 — PMS identity model: `Employee` separate from `User`, additive `PmsRole`

**Status:** Accepted (2026-08-24, Tariq Al-Naaimi)
**Date:** 2026-08-24
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The HR team supplied a build-ready functional specification for a Performance Management
System (`docs/blueprints/performance-management-system.md`; spec v1.0). It describes a group
of three entities (Rihal parent, TP, CL), five role tracks, and a role/permission model with
five distinct actors — Employee, Line Manager, HR Super Admin, HRBP, and a read-only
COO/Ops Director — plus a Strategy team that has **no system access at all** but whose scores
HR keys in on their behalf (§4.1).

The template today has a single `User` model carrying `Role { ADMIN, EDITOR, VIEWER }`, used
for platform administration and enforced by `withAdminAuth` / `withEditorAuth`. The obvious
move — extend `User` with HR fields and widen `Role` — has to be evaluated against three
things the spec says explicitly:

- **§3.1/§3.2:** employee data is loaded from Excel (later Odoo) into "an internal employee
  table the system owns", keyed on the Odoo employee ID as a **permanent** unique key that
  "must never shift on re-import". Every downstream record attaches to that key.
- **§4.1:** the Strategy team has no login. Leavers (§12.1) keep records forever and must
  never be deleted. Employees exist in the system before they ever sign in.
- **§4.3:** roles are **additive** — "a user may hold more than one; permissions merge (most
  access wins)… Do not invent hybrid roles — stack the standard ones." The COO holds Line
  Manager _and_ Executive Viewer; an HR Super Admin who manages a team holds both.

Changing the `Role` enum or role checks is an Ask-before item under CLAUDE.md, so the
alternatives had to be weighed rather than assumed.

## Decision drivers

- **The employee population ≠ the login population.** Any model that requires a `User` row per
  employee contradicts §4.1 (Strategy team) and forces phantom accounts for leavers — a
  standing security liability in a system holding Restricted salary data.
- **The Odoo ID must be the stable key from day one (§3.2).** Whatever holds employee data must
  key on it natively, not correlate to it.
- **"One owner per assessment" is a structural invariant, not a convention** (Appendix A). The
  design must make it hard to misconfigure, not merely documented.
- **The `Role` enum is load-bearing for platform auth.** Widening it entangles HR authority with
  platform administration, and every existing `withAdminAuth` check silently changes meaning.
- **Additive roles with no hybrids (§4.3).** The representation must compose, not enumerate
  combinations.

## Considered options

### Option 1 — Separate `Employee` table + additive `PmsRole[]`, `Role` untouched (chosen)

`Employee` is the internal employee table keyed on `odooId @unique`, with a nullable unique
`userId` link to `User` for those who log in. PMS authority is a separate additive enum
`PmsRole { HR_SUPER_ADMIN, HRBP, EXECUTIVE_VIEWER }` stored as an array on `Employee`.
Line-manager authority is **derived** from `Employee.managerId` edges and is not a stored role.

- Good, because it satisfies §3.1's "internal employee table the system owns" literally, with
  the Odoo ID as the table's own natural key.
- Good, because employees without logins (Strategy team) and leavers are ordinary rows — no
  phantom accounts, no dormant credentials attached to Restricted data.
- Good, because deriving line-manager authority from the org edge makes §4.2's "editing and
  sign-off is always reserved for the direct line manager" true by construction: there is no
  field an admin could set to grant someone else's sign-off rights.
- Good, because `PmsRole[]` composes exactly as §4.3 describes — the COO row simply carries
  `EXECUTIVE_VIEWER` and has direct reports; no `COO_WHO_ALSO_MANAGES` hybrid can exist.
- Good, because platform auth is untouched: existing `withAdminAuth` checks keep their current
  meaning and the Ask-before `Role` surface is not disturbed.
- Bad, because two identity tables must be kept linked, and a lookup (`resolveActor`) sits on
  every PMS request path.
- Bad, because an employee whose email changes in Odoo could drift from their `User.email`
  until relinked.

### Option 2 — Extend `User` with HR fields and widen `Role`

Add `odooId`, `managerId`, `roleTrack`, `basicSalary` to `User`; add `HR_SUPER_ADMIN`, `HRBP`,
`EXECUTIVE_VIEWER`, `LINE_MANAGER` to `Role`.

- Good, because there is one identity table and no join.
- Bad, because it forces a `User` row for every employee — contradicting §4.1 and creating
  login-capable rows for people who must not have access, including leavers.
- Bad, because `Role` is a single scalar: it cannot express §4.3's additive stacking without
  either hybrid enum members (explicitly forbidden) or a second mechanism anyway.
- Bad, because it entangles HR authority with platform administration — after the change, every
  existing `role !== "ADMIN"` check means something subtly different.
- Bad, because it puts Restricted salary on the Auth.js user record, which is selected on
  session paths and adapter operations — a much wider exposure surface than a dedicated table.

### Option 3 — Separate `Employee` table + a `PmsRoleAssignment` join table

As Option 1, but roles live in their own relation rather than an array column.

- Good, because each assignment can carry its own metadata (granted-by, granted-at, expiry).
- Good, because it audits at assignment granularity rather than as a whole-array diff.
- Bad, because it adds a join to the hot path of every permission check, for a set that is
  three values deep and changes rarely.
- Bad, because the spec asks for none of that metadata; it is speculative structure (pillar 3
  penalises it) that can be added later without a rewrite if §4 ever grows time-bounded roles.

## Decision

**Option 1.** `Employee` is a first-class table keyed on `odooId`, linked optionally to `User`;
PMS authority is the additive `PmsRole[]` plus derived line-manager authority from
`Employee.managerId`. The `Role` enum, `lib/auth.ts`, and `lib/api-helpers.ts` are not touched.

The binding drivers were the first and third: the employee population genuinely is not the
login population (Option 2 cannot represent the Strategy team or a leaver without a phantom
account), and deriving manager authority from the org edge is the only one of the three options
that makes "one owner per assessment" unfalsifiable rather than merely documented. Option 3 was
rejected as speculative for a three-value set, and is the named upgrade path if role metadata is
ever required.

Capability resolution is centralised in `lib/pms/permissions.ts`
(`canViewEmployee` / `canActOnEmployee` / `canViewCompensation` / `canConfigure`), with
`lib/pms/actor.ts` resolving a session to an actor once per request. Field-level salary
confidentiality (§4.5) is enforced in `lib/pms/employee-select.ts`, which builds the Prisma
`select` from capabilities so `basicSalary` never enters an unauthorised payload.

## Consequences

### Positive

- The §3.1 import mandate and the §3.2 stable-key requirement are satisfied by the schema
  itself rather than by discipline.
- No login-capable account exists for anyone the spec says must not have access.
- Restricted salary lives on a table that is never selected by session or adapter code paths.
- §4.3's additive model is representable exactly, with hybrid roles structurally impossible.
- The v2 Odoo sync (§14) lands as a second loader against the same key, with no identity rework.

### Negative

- Two tables to keep linked; a `resolveActor` lookup on every PMS request.
- An employee's `User.email` can drift from `Employee.email` after an Odoo email change.
- Some code paths need both records in hand, which is more ceremony than a single `session.user`.
- **The separation is least-privilege-by-default, NOT a boundary against a hostile platform
  admin.** See the section below; this was originally stated too strongly and is corrected here.

### What this separation does and does not buy (corrected 2026-08-24)

The `unlinkedActor` docstring in `lib/pms/actor.ts` said "platform administration does not confer
HR authority". As an accurate description of the _resting state_ that is true, and it was
verified on live payloads: a `Role.ADMIN` with no `Employee` record sees **0 employees and no
`basicSalary` key**. As a security claim about what an admin can _reach_, it was wrong. A
post-deploy review raised it, and both routes were then reproduced end to end:

1. **Provision-and-claim.** `POST /api/users` lets an admin choose the email _and_ the password.
   Creating a login on an unclaimed HR Super Admin's address and signing in linked the accounts
   via `resolveActor`'s first-login email match, yielding `pmsRoles: ["HR_SUPER_ADMIN"]`,
   `viewCompensation: true`, and 20 employees per page **with salary**.
2. **Password takeover.** `PUT /api/users/[id]` lets an admin set any user's password. Against an
   _already linked_ HR Super Admin — the state a legitimately onboarded user is in — this granted
   the same access. Closing route 1 alone would therefore have been theatre.

This is not a defect in the two-table design; it is what "the platform admin manages credentials"
means anywhere. It is recorded rather than fixed because the fix is not code: it is deciding who
holds `Role.ADMIN`. **The separation still earns its place** — it makes HR authority explicit and
grantable, keeps the no-login population representable, and means an admin who has not taken
either action above genuinely cannot read pay.

What makes the risk _manageable_ is that both routes are audited. Verified in `audit_logs`:
route 1 writes `CREATE User` and then an `UPDATE Employee` carrying
`{"userId": {"from": null, "to": "<the new user>"}}` — an explicit, readable record of an
identity being claimed. Route 2 is the weak spot: `passwordHash` is in `SCRUB_FIELDS`, so the row
lands with `changes: null` and an admin resetting someone's credentials is indistinguishable from
an admin fixing a typo in their name. Recorded in `docs/findings-register.md` with the proposed
fix (log scrubbed field _names_ with redacted values, the way the import preview already renders
`basicSalary: [redacted] → [redacted]`) pending operator sign-off, because
`lib/prisma/audit-extension.ts` is an Ask-before surface.

### Mitigations

- `resolveActor` is a single indexed lookup on `Employee.userId` and is called once per request,
  not per check.
- First-login linking matches on email; the import records name/email changes on a stable
  `odooId` in the batch report so HR can see a drift and relink deliberately.
- `lib/pms/actor.ts` is the only place that assembles the pair, so callers receive one object.

## Alternatives considered

1. **Extend `User` and widen `Role`** — rejected: cannot represent the no-login population or
   additive roles, and entangles HR authority with platform auth. See Considered options.
2. **`PmsRoleAssignment` join table** — rejected as speculative structure for a three-value set;
   named as the upgrade path if role metadata is ever needed. See Considered options.

## Migration triggers

Revisit when any of these become true:

- §4 grows time-bounded, delegated, or scoped role assignments (e.g. an HRBP scoped to one
  entity, or a covering HR admin for a leave period) → move to Option 3's join table.
- SSO/SCIM becomes the provisioning path for employees as well as users (ADR-045), making the
  `User`↔`Employee` link automatic → re-evaluate whether the split still earns its cost.
- The Odoo sync (§14, v2) starts supplying login identity as well as org data.
