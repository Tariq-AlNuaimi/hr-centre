# ADR-069 — Employee access: import-provisioned logins, SSO, and two role systems that stay two

**Status:** Accepted — implemented 2026-08-26 (the operator signed off on the `lib/auth.ts` change;
an Ask-before surface, CLAUDE.md)
**Date:** 2026-08-26
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-065 (the User/Employee split)

## Context

The system was credentials-only, and the only two writers of a `User` row were `prisma/seed.ts`
(the bootstrap admin) and `POST /api/users`, one person at a time through `/users/new`. **Applying
an employee import created no logins.** In the demo fixture that meant thirty-seven people in the
directory and one who could sign in.

The specification never says "provision logins in bulk", so this is not a clause violation. It is
worse than that in practice: §3.3 lists Email "for login/notifications", and §4.4's My Tasks, §9.7's
rater invitations and §13.1's scorecard are each addressed to a person who, as shipped, had no way
in. The 2026-08-25 conformance report's admission that "every screen-run was an HR Super Admin" was
the gap showing through — nobody else _could_ run a screen. The 2026-08-26 delivery pass had to
hand-provision five accounts before it could exercise §4.1's matrix as anyone but HR.

The operator named the second half of it: "we have two users, hr users and normal users i think
this is also a gap". That is a real seam, and naming it correctly is what makes the first fix
principled rather than arbitrary. There are two role systems and they answer different questions:

|            | `User.role` (ADMIN / EDITOR / VIEWER)                                                               | `Employee.pmsRoles` (HR_SUPER_ADMIN / HRBP / EXECUTIVE_VIEWER)                                  |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Lives on   | the login identity                                                                                  | the org record                                                                                  |
| Set at     | `/users`, `/users/new`                                                                              | `/admin/roles`                                                                                  |
| Governs    | **platform** administration: `/api/users`, `/api/recycling-bin`, `/api/audit-log` (`withAdminAuth`) | the **HR process**: §4.1's whole matrix — calibration, publish, import, reports, employee edits |
| Comes from | this template                                                                                       | the specification                                                                               |

ADR-065 made that split deliberate and it is right: the employee population is not the login
population, and §4.1's authority derives from org edges, not from who administers the app. What
ADR-065 did **not** decide is which `User.role` a _person_ should get. Creating a login forced a
choice between three template words with no meaning in §4.1, and the delivery pass picked `VIEWER`
on instinct. An instinct is not a rule.

## Decision

1. **Applying an import provisions a login for every employee it CREATES.** `lib/pms/import/run.ts`
   calls `provisionLogin` inside the same `auditedTransaction` as the employee create, so a failed
   apply provisions nobody and the audit rows roll back with it (ADR-068). The apply summary reports
   the count beside the created/updated counts it already reported.

2. **A provisioned account has NO password.** `passwordHash` is left null — not a random string, not
   a default. `authorize()` already returns null when the hash is absent, so credentials sign-in is
   _impossible_ for that account rather than weakly possible. A random password would be a real
   secret that nobody is ever told: able to leak, unable to help.

3. **A provisioned account is a `VIEWER`.** Platform administration is a separate, deliberate grant
   that nobody acquires by appearing in an HR spreadsheet. Their §4.1 authority comes from
   `pmsRoles` and only from there.

4. **Provisioning is idempotent and never destructive.** Find-or-skip on the lowercased email; never
   overwrite a role, never reset a password, never re-link an employee that already has a `userId`.
   §3.5 makes re-importing routine, and a weekly re-import must disturb nobody. The existence check is
   **two** reads, because the unique email index does not respect the soft-delete filter: an audited
   read reports "no account" for an off-boarded one, and the `create` that followed would take the
   whole import down with a constraint violation. (`prismaUnfiltered` would answer in one query and
   is refused here by the `no-prisma-unfiltered-import` floor rule — correctly: two narrow indexed
   reads cost nothing and keep the import on its audited client.) Finding a soft-deleted account is a
   skip, never a re-link — revoked access is a decision a person made, and a re-hire appearing in a
   spreadsheet is not the undoing of it.

5. **A LEAVER is never provisioned.** §12.1 preserves a leaver's record and history — not their
   access. Minting a login for someone who has left is the opposite of an off-boarding step.

6. **SSO returns, env-gated and inert when unset.** `MicrosoftEntraID` ships in `next-auth`, so
   there is no new dependency. The provider is added only when all three of
   `AUTH_ENTRA_ID`, `AUTH_ENTRA_SECRET` and `AUTH_ENTRA_TENANT_ID` are present — the same posture `lib/email.ts` takes for SMTP — so an
   unconfigured deployment shows a credentials form and nothing else rather than a broken button.
   `lib/sso/role-map.ts` maps IdP group/role claims to `User.role` with a least-privilege default of
   `VIEWER`, which is the same answer the import gives: the two paths cannot disagree about what a
   person is.

   The mapping applies **only when SSO itself creates the account** (`trigger === "signUp"`), and the
   mapped role is written to the row so the session and `/users` agree from the first request. Every
   other sign-in takes the stored role. Both alternatives are worse: re-mapping on every federated
   sign-in makes an unset or misspelled `SSO_ADMIN_GROUPS` demote every administrator on their next
   login — with nobody left who can reach `/users` to undo it — and mapping _without_ persisting
   leaves the JWT saying ADMIN while the row says VIEWER, which is a real grant (`withAdminAuth`
   reads the session) that the one screen built to show it does not show. So the directory seeds a
   new federated account; `/users` governs it thereafter. The honest consequence: for a population
   provisioned by import, `SSO_ADMIN_GROUPS` will rarely fire, because those accounts already exist.

7. **The two role systems stay two.** No schema merge. ADR-065's split is correct and this decision
   reaffirms it; what was missing was that the rule was never stated and that neither screen showed
   the other's fact. `/admin/roles` gains a "Can sign in" column (`hasLogin`, a boolean derived from
   `Employee.userId` in `serializeEmployee`) so HR can see authority and access together — granting
   HRBP to somebody with no account grants nothing.

## Consequences

- Applying an import now writes `User` rows. That is a larger blast radius for an HR action than it
  had before, which is why every one of them is passwordless, VIEWER, audited, and inside the
  transaction that can undo them.
- **Until an IdP is configured, provisioned accounts are shells.** Stated plainly rather than papered
  over: with no SSO and no SMTP (F9) there is no way for the holder to authenticate. This is why the
  operator asked for SSO in the same breath, and why SSO ships built-and-inert rather than
  unverified-and-claimed.
- SSO cannot be verified end-to-end in this environment — no IdP credentials exist. What IS verified:
  `mapSsoRole`'s claim handling by unit test, the provider's absence when the env is unset, and
  `lib/auth.ts`'s existing `signIn` callback refusing a soft-deleted user (which becomes load-bearing
  the day a provider is configured). The same honest posture as SMTP.
- `lib/pms/actor.ts` already documents that a platform ADMIN **can** obtain HR authority by
  provisioning a login on an unclaimed employee's email — audited, but possible. Minting `VIEWER`s
  does not change that; it means the import is not a second, quieter way to mint admins.
- ~~An existing LEAVER's account is not revoked on import.~~ **Amended 2026-08-26 — see below.**

## Alternatives considered

- **Provision with a random password and email it.** Rejected: needs SMTP (F9, unresolved), and it
  creates thirty-six real secrets to protect in order to solve a problem SSO solves with none.
- **Provision on first sign-in instead (JIT).** Rejected for the import path: it cannot work while
  credentials are the only provider (there is nothing to sign in _with_), and it hides from HR the
  fact that a person has no access. It remains the fallback for an SSO user who matches an employee
  by email.
- **Merge the two role systems** — put `pmsRoles` on `User`, or derive `User.role` from `pmsRoles`.
  Rejected: ADR-065's reasons still hold. Most employees need no platform role at all, and coupling
  them would mean every HRBP grant silently widened `/api/audit-log` and `/api/recycling-bin`.
- **A "create login" button on `/admin/roles`.** Rejected: a third way to mint accounts, on the
  screen whose whole job is the other role system. The import creates them; `/users/new` remains the
  platform admin's hand path.

## Verification

- `tests/integration/pms-import-provisioning.test.ts` — four DB-backed cases against the SHIPPED
  `provisionLogin`: linked + passwordless + VIEWER; a LEAVER gets nothing; a re-import leaves a
  hand-made ADMIN account's role and password untouched; a soft-deleted account neither collides nor
  is resurrected. Both non-obvious ones are mutation-checked — forcing `provisionLogin` to return
  false turns case 1 red, and putting the existence check back on the filtered client turns case 4
  red with the unique-constraint violation it predicts.
- `tests/contracts/sso-role-map.test.ts` — six cases over `mapSsoRole`, including the
  least-privilege default and the Entra SAML claim URI.

---

## Amendment, 2026-08-26 — off-boarding revokes access

**Status:** Accepted — operator decision, answering open question 2 above.

§12.1 says a departure preserves the employee's RECORD and history. It says nothing about their
login, and this ADR originally read that silence as "leave the account alone": the import refuses to
CREATE a login for a leaver, but an account that already existed survived the departure untouched. A
person who left on Friday could sign in on Monday, see their own scorecard, and answer a 360 they had
been assigned — until somebody at `/users` remembered.

**Decision: setting an employee to LEAVER soft-deletes the linked `User`.** Access follows employment;
the record does not.

**One helper, three callers.** `revokeLoginOnOffboard` (`lib/pms/offboarding.ts`) is called from every
path that can turn someone into a leaver, each inside the same transaction as the status change:

| Path                      | Why it has to be here too                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/leavers`       | §12.1's manual half — an immediate resignation                                                                                                      |
| `applyImport`             | §3.2 makes the sheet the system of record for status; an org whose departures arrive by spreadsheet would otherwise keep every leaver's login alive |
| `PUT /api/employees/[id]` | HR fixing a record by hand is the quietest of the three, which is exactly why it must not be the one that leaves a login live                       |

All three guard on the **transition**, not the value, so re-saving or re-importing an already-departed
record does nothing.

**Why a soft delete is the right instrument.** Both sign-in paths already refuse a soft-deleted
account and neither had to change: `authorize()` looks up `deletedAt: null`, and the `signIn` callback
refuses a federated identity whose row is soft-deleted — the guard kept deliberately for the day a
provider returned. This decision is what makes it load-bearing. It is also reversible by a person:
`/recycling-bin` restores a `User`, so an off-boarding done in error is a restore rather than a
re-creation, keeping the `Account` linkage and the audit history on the same id.

**One change was required, in `lib/auth.ts`.** The per-request revocation check read
`passwordChangedAt` on the UNFILTERED client, so a session issued before the departure would have
survived until `maxAge`. `deletedAt` joins that same narrow indexed read, and anything other than an
explicit null tears the session down — a revocation that leaves the departing person signed in for the
rest of the day is not a revocation. The guard fails CLOSED by design.

**What it deliberately does not do:** it does not touch the employee row (§12.1 preserves the record,
and `recyclable.ts` excludes Employee from the bin for that reason); it does not unlink
`Employee.userId` (the link is how a restored account finds its way back, and how the audit trail
stays legible); and it does nothing at all for an employee who has no login, which is most of the
fixture today.

**A property of the soft-delete extension worth recording:** `delete` is **not idempotent**. The
extension rewrites it to an `update` on the BASE client, which carries no read filter, so deleting an
already-deleted row succeeds, re-stamps `deletedAt` to now, and emits a second `DELETE` audit row. The
helper therefore checks for an existing `deletedAt` first — otherwise a weekly re-import that still
listed last year's leaver would move the revocation date, and §12.2's trail would name a date on which
nobody revoked anything.

**Verification.** `tests/integration/pms-offboarding-revokes-login.test.ts` — the account is
soft-deleted and invisible to the audited client while the employee record and its link survive; an
employee with no login off-boards quietly; revoking twice is a no-op. Plus a contract test that the
live session is torn down, mutation-checked against the pre-change guard.
