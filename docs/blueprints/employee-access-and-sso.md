# Blueprint — employee access: import-provisioned logins, SSO, and one role story

Scope: lib/auth.ts, lib/sso/**, lib/pms/import/run.ts, lib/pms/import/types.ts, lib/pms/employee-select.ts, lib/pms/offboarding.ts, app/api/leavers/route.ts, app/api/employees/[id]/route.ts, app/api/imports/[id]/apply/route.ts, app/[locale]/(dashboard)/admin/import/**, app/[locale]/(dashboard)/admin/roles/**, components/pms/RoleEditor.tsx, prisma/seed-pms.ts, messages/**, .env.example, docs/decisions/ADR-069-employee-access.md

Feature parity: n/a — this is not a product category with competitors to benchmark. It is
closing a gap between this build and its own specification (§3.3 "Email — for login/notifications";
§4.4, §9.7 and §13.1 all presuppose the employee has an account). The relevant prior art is the
repo's own `/scale-up` SSO recipe (`docs/recipes/saas/1-sso-oidc-saml.md`), which this follows
rather than reinvents.

Confirmed: 2026-08-26 — operator, in session ("fix it ofcurse and add sso, also we have two
useres, hr users and normal users i think this is also a gap").

> Full track: touches `lib/auth.ts`, an Ask-before surface. Operator authorised both halves
> explicitly. Governance of record: ADR-065 (the User/Employee split this builds on) and
> ADR-069 (this decision).

## Problem & outcome

**36 of 37 people in the fixture cannot sign in.** The system is credentials-only — the SSO
providers were removed on 2026-08-21 — so a person can sign in only if a `User` row exists.
The only writers of one are `prisma/seed.ts` (the bootstrap admin) and `POST /api/users`, one
person at a time through `/users/new`. **Applying an employee import creates no logins.**

The specification never says "provision logins in bulk", so this is not a clause violation. It
is worse than that in practice: §4.4's My Tasks, §9.7's rater invitations and §13.1's scorecard
are all addressed to a person who, as shipped, has no way in. The 2026-08-25 conformance report's
own admission that "every screen-run was an HR Super Admin" was a symptom — nobody else _could_
run a screen. The delivery pass on 2026-08-26 had to hand-provision five accounts before it could
test §4.1's matrix as anyone but HR.

**Outcome:** applying an import gives every new employee an account; SSO makes that account usable
without anyone inventing or transporting a password; and the two role systems stop being a coin
toss at account-creation time.

## The second gap, which decides the shape of the first

The operator's observation — "we have two users, hr users and normal users" — is a real seam, and
naming it correctly is what makes the import fix principled rather than arbitrary.

There are two role systems, and they answer different questions:

|            | `User.role` (ADMIN / EDITOR / VIEWER)                                                               | `Employee.pmsRoles` (HR_SUPER_ADMIN / HRBP / EXECUTIVE_VIEWER)                                  |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Lives on   | the login identity                                                                                  | the org record                                                                                  |
| Set at     | `/users`, `/users/new`                                                                              | `/admin/roles`                                                                                  |
| Governs    | **platform** administration: `/api/users`, `/api/recycling-bin`, `/api/audit-log` (`withAdminAuth`) | the **HR process**: §4.1's whole matrix — calibration, publish, import, reports, employee edits |
| Comes from | this template                                                                                       | the specification                                                                               |

ADR-065 made the split deliberate and it is right: the employee population is not the login
population, and §4.1's authority is derived from org edges, not from who administers the app.

What was NOT decided is what `User.role` a _person_ should get. Creating a login today forces a
choice between three template words with no meaning in §4.1 — the delivery pass had to pick one to
provision anything, and picked `VIEWER` on instinct. An instinct is not a rule.

**Decision:** an employee provisioned from an import is a `VIEWER`. Platform administration is a
separate, deliberate grant that nobody acquires by appearing in an HR spreadsheet. Their PMS
authority comes from `pmsRoles` and only from there. This is least-privilege, and it makes the
import's behaviour statable in one sentence instead of configurable.

It also has a security consequence worth writing down rather than discovering: `lib/pms/actor.ts`
already documents that a platform ADMIN **can** obtain HR authority by provisioning a login on an
unclaimed employee's email, or resetting a linked user's password — audited, but possible. Making
the import mint `VIEWER`s does not change that; it means the import is not a second, quieter way
to mint admins.

## User stories

- **US-1 — HR applies an import.** Every new employee in the file gets a login they can use,
  without HR creating 36 accounts by hand. HR sees how many were provisioned.
- **US-2 — An employee signs in for the first time.** They use their corporate identity. No
  password is invented for them, mailed to them, or set by HR on their behalf.
- **US-3 — A returning employee's record changes.** A re-import updates their org record and does
  **not** disturb their login, their password, or their linkage.
- **US-4 — A leaver is imported as LEAVER.** §12.1 keeps their record and history. Their access is
  a separate question this blueprint answers explicitly rather than by omission.
- **US-5 — IT fronts the app with the corporate IdP.** They set the provider env vars; SSO becomes
  the sign-in path. Credentials remain as break-glass for the bootstrap admin.
- **US-6 — HR looks at one person.** They can tell whether that person can sign in at all, without
  cross-referencing two screens.

## Happy path

1. HR uploads the employee sheet and previews it (unchanged).
2. HR applies it. For each employee the import CREATES, it also creates a `User`:
   - `email` — the employee's, lowercased (the same key `resolveActor` links on).
   - `passwordHash` — **null**. Not a random string, not a default: null.
   - `role` — `VIEWER`.
   - linked to the `Employee` row immediately, so first-login email matching is a fallback rather
     than the mechanism.
3. The apply summary reports `N logins provisioned` beside the counts it already reports.
4. The employee visits the app and signs in with the corporate IdP. Auth.js matches the account by
   email, the `Account` row is created, and they are in.
5. Their sidebar and My Tasks are whatever §4.1 and §4.4 give them — no change to any of that.

## Worst paths — the ones that decide the design

- **A provisioned account must not be signable-into with a guessed password.** `passwordHash` is
  `String?` and `authorize()` already returns null when it is absent, counting the attempt toward
  the lockout. So a null hash makes credentials login _impossible_ for that account rather than
  weakly possible. This is why the answer is null and not a random password: a random password is
  a secret that exists, and a secret that exists can be reset, leaked, or logged.
- **Without SSO or SMTP, a provisioned account cannot be used at all.** Stated plainly rather than
  papered over: until an IdP is configured, these accounts are shells. The forgot-password flow
  would also serve, and it needs SMTP (F9). This blueprint does not pretend otherwise — it is why
  the operator asked for SSO in the same breath.
- **An email that already has a `User`.** Re-import, or an employee whose account was hand-made.
  Provisioning must be idempotent: find-or-skip on email, never overwrite, never reset a password,
  never touch `role`. A re-import must be able to run every week without disturbing anyone.
- **Two employees with the same email.** §3.4 already rejects duplicate emails at import
  validation, so this cannot reach the provisioning step. Asserted, not assumed.
- **An employee row already linked to a different `User`.** Leave both alone; `resolveActor`'s
  `userId: null` guard exists for exactly this and must not be undermined here.
- **A LEAVER in the import.** Do **not** provision. §12.1 preserves their record, not their access,
  and minting a login for someone who has left is the opposite of what an off-boarding step should
  do. An existing leaver's account is out of scope here and is called out as an open question.
- **The IdP returns a user whose email matches nobody.** They get an unlinked actor: a session that
  sees nothing and can configure nothing (`unlinkedActor`). That is the existing, documented
  resting state and needs no new branch.
- **The IdP is misconfigured or absent.** The provider block must be _inert_ when its env vars are
  unset — the same posture `lib/email.ts` takes for SMTP — so an unconfigured deployment shows a
  credentials form and nothing else, rather than a broken button.
- **A soft-deleted (off-boarded) user signs in via SSO.** `lib/auth.ts` already carries the
  `signIn` callback guarding this, kept deliberately for the day a provider returns. That day is
  now; the guard becomes load-bearing and needs a test.

## Architecture sketch

**Provisioning** lives in the import's apply step, not in a new endpoint. `lib/pms/import/run.ts`
already creates employees inside `auditedTransaction`; the `User` create joins that transaction, so
a failed apply provisions nobody. Audit rows come free from the extension and now roll back with it
(ADR-068).

**SSO** follows `docs/recipes/saas/1-sso-oidc-saml.md` part (a): OIDC providers ship inside
`next-auth`, so **no new dependency**. The provider array becomes conditional on env presence, and
the `mapSsoRole` seam maps IdP groups to `User.role` with least-privilege default `VIEWER` — which
is the same answer the import gives, so the two paths cannot disagree about what a person is.

**One role story** is a documentation and surfacing change, not a schema one: the two systems stay
separate (ADR-065 is right), but `/admin/roles` gains a "can sign in" column so HR can see access
and authority in one place, and ADR-069 states the rule.

## Open questions

1. **Which IdP?** Entra, Okta or generic OIDC. The code shape is identical; only env names differ.
   Until IT supplies client id / secret / issuer, SSO ships **built and inert** — verifiable by
   construction and by unit test, but not end-to-end. Same honest posture as SMTP (F9).
2. **Should an existing LEAVER's login be revoked on import?** Off-boarding today is a `status`
   change; whether it should also soft-delete the `User` is a policy question for the operator, not
   a defect. Not in scope here.
3. **Should `/users` remain visible to HR at all?** With provisioning automatic, the hand-create
   screen is a platform-admin tool. Leaving it is harmless; hiding it is a later simplification.
