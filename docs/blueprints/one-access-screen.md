# Blueprint — one access screen, and a platform role that tells the truth

Scope: app/[locale]/(dashboard)/admin/access/**, app/[locale]/(dashboard)/users/**, app/[locale]/(dashboard)/admin/roles/**, components/users/**, components/pms/RoleEditor.tsx, components/layout/AppSidebar.tsx, components/layout/CommandPalette.tsx, lib/validations/user.ts, lib/api-helpers.ts, app/api/users/**, lib/pms/employee-select.ts, messages/**, tests/contracts/api-auth.test.ts, tests/uat/crud.full.uat.ts, docs/decisions/ADR-070-one-access-surface.md

Feature parity: n/a — not a product category with competitors. This is the repo reconciling two role
vocabularies it grew separately: the template's `User.role` and §4.1's `Employee.pmsRoles`.

Confirmed: 2026-08-27 — operator, in session: "i think you should merge users sections and hr roles
sections, or expand the roles because how come that i can add useres to the platform and they have
the three roles veiewr, or editioer or admin, which dosnet align with the rest of the app". Four
decisions taken: collapse the platform role to a checkbox · merge the two screens · blueprint first ·
before the demo.

> Full track: touches role checks and the shape the API accepts for `role` — an Ask-before surface
> (CLAUDE.md). Governance of record: ADR-065 (the split this keeps), ADR-069 + amendment (login
> provisioning and revocation), ADR-070 (this decision).

## Problem & outcome

**The platform role is a binary wearing a three-value costume.**

`/users/new` offers ADMIN / EDITOR / VIEWER. Measured against the code:

| Value    | What it actually gates                                                                  |
| -------- | --------------------------------------------------------------------------------------- |
| `ADMIN`  | `/api/users`, `/api/recycling-bin`, `/api/audit-log` — and the sidebar entries for them |
| `EDITOR` | **Nothing.** `withEditorAuth` is defined in `lib/api-helpers.ts` and **never called**   |
| `VIEWER` | Nothing                                                                                 |

Every read of `User.role` in the product is `=== "ADMIN"` — three call sites in the UI, one wrapper
in `api-helpers`. So HR is asked to make a three-way choice the product reads as two-way, in words
that appear nowhere in the specification. A control that does not do what it appears to do is worse
than a missing control: the first teaches something false, the second teaches nothing.

The second half is where it lands on a person. Authority in this product is split across two screens
that never mention each other:

- **`/users`** (platform ADMIN only) — creates logins, sets the platform role.
- **`/admin/roles`** (HR Super Admin only) — grants §4.1's HR authority.

Neither is wrong; ADR-065's split is right and this blueprint keeps it. What is wrong is that
answering _"what can this person do?"_ means visiting two screens, holding two vocabularies, and
knowing that one of the three values on the first is decorative.

**Outcome:** one screen answers the question, and the platform role stops offering a choice it does
not honour.

## The constraint that shapes the design

**`User` rows can exist with no `Employee`.** The bootstrap admin on every deployment is exactly
that, and an IT service account would be too. ADR-065 separated the populations deliberately: the
login population is not the employee population.

So this is a merge of two _views_, not of two _tables_. A screen that only lists employees would hide
the bootstrap admin — the single most privileged account in the system — which is the opposite of
what an access screen is for.

**And a privilege boundary that must not move.** Today an HR Super Admin cannot grant platform
administration, and a platform admin cannot grant §4.1 authority. Folding platform-admin into
`/admin/roles` would hand HR the ability to mint platform admins. The merged screen therefore shows
both facts to everyone who can see it, and lets each viewer edit **only the half their own role
governs**.

## User stories

- **US-1 — HR asks "what can Layla do?"** One screen, one row: her HR roles, whether she can sign in,
  and whether she is a platform administrator. No cross-referencing.
- **US-2 — HR grants HRBP to someone with no login.** The screen says so on the same row, so the grant
  is not silently inert.
- **US-3 — A platform admin creates a login for a new IT hire who is not an employee.** Still possible,
  still visible, and clearly labelled as an account with no employee record.
- **US-4 — Someone asks "what is a VIEWER?"** The question stops being askable: the field becomes a
  single checkbox naming exactly what it grants.
- **US-5 — An HR Super Admin tries to make themselves a platform admin.** Refused, as today. The
  control is visible but not theirs to operate.
- **US-6 — An existing account is already `EDITOR`.** Nothing breaks. It reads as "not an
  administrator", which is what it has always meant in practice.

## Happy path

> **Amended during the build, 2026-08-27.** Steps 1 and 2 below were written before the constraint
> above was fully priced, and the build did not honour them as stated. What shipped is recorded here
> rather than left as a silent divergence; the reasoning is in ADR-070 "What was NOT done".
>
> - **One table became two SECTIONS on one page.** A single list would have to invent an employee row
>   for the bootstrap admin or hide it, and hiding the most privileged account is the opposite of what
>   an access screen is for.
> - **The one-row join happens on the ACCOUNTS table only.** Putting `isPlatformAdmin` on the employee
>   payload would have meant widening `/api/employees`, which is visibility-scoped and read by every
>   signed-in employee. Platform-admin status is target information; it stays on the admin-only list.
>   Cost, stated: an HR Super Admin who is not also a platform admin sees that the section exists and
>   who to ask, not the per-person answer.

1. `/admin/access` shows two sections: **Logins & platform administration** (every `User`, including
   those with no employee record) and **HR authority** (every employee).
2. An accounts row shows: name · email · **platform administrator** (yes/no) · §4.1 HR roles ·
   last sign-in. A people row shows: name · entity · §4.1 HR roles · **can sign in** (ADR-069's three
   states: none / active / revoked).
3. An HR Super Admin edits the HR roles. A platform admin edits the platform-admin checkbox and
   creates logins. Whoever holds both edits both. Each sees the other section with the reason in it.
4. Creating a login asks for email, name, password, and one checkbox — _"Platform administrator: can
   manage logins, the recycling bin and the audit log"_ — instead of a dropdown.
5. `/users` and `/admin/roles` redirect to `/admin/access` (id-preserving for `/users/<id>`) so
   existing links and muscle memory survive.

## Worst paths — the ones that decide the design

- **An HR Super Admin must not be able to grant platform administration.** The checkbox renders
  disabled for them, with the reason, rather than being hidden — a hidden control teaches nothing,
  and §4.1's refusals are sentences elsewhere in this product.
- **A platform admin must not be able to grant HR authority.** Symmetric, same treatment.
- **The last platform admin must not be able to remove themselves.** `/api/users` already refuses
  self-demotion; the merged screen surfaces that refusal verbatim rather than re-implementing it.
- **Existing `EDITOR` rows.** No migration. The enum keeps the value so stored rows stay valid; the
  API stops _accepting_ it and the UI stops offering it. Anything that is not `ADMIN` renders
  identically, which has always been the truth.
- **An account with no employee record.** Its own group, named — never merged into the employee list
  where it would look like a person with a missing record.
- **A revoked account.** Reads REVOKED, not "no login" (ADR-069's amendment). The remedies differ.
- **Two screens' worth of data on one screen.** The employee list is already paginated and
  visibility-scoped; the account list is small and bounded. Neither becomes an unbounded read.

## Architecture sketch

**One route, `/admin/access`**, gated on `isHrSuperAdmin OR platform ADMIN` — the union, because each
sees the half they govern. `/users` and `/admin/roles` become redirects, so nothing that links to
them breaks.

**The platform role stops being a dropdown at the boundary, not just in the UI.** `createUserSchema`
and `updateUserSchema` narrow `role` from `z.enum(["ADMIN","EDITOR","VIEWER"])` to a boolean
`isPlatformAdmin`, mapped to `ADMIN` / `VIEWER` at the route. Narrowing the _schema_ is what makes it
real: a UI-only change leaves the API accepting a value nothing honours.

~~**`withEditorAuth` is deleted**, not left dormant.~~ **Amended during the build:** measuring the
blast radius reversed this. It is TEMPLATE machinery, not fork code —
`scripts/scaffold-entity.mjs --writes editor` emits it, `scripts/rbac-matrix.mjs` resolves it, and two
ESLint rules (the security floor, an Ask-before surface) name it. Deleting it breaks the scaffolder
for every fork of this template to close a gap the schema change already closes: EDITOR can no longer
be granted. The wrapper keeps a comment saying it gates nothing here, and a contract test pins that
`withAdminAuth` refuses an EDITOR session. See ADR-070 "What was NOT done".

**Reuse, not rebuild.** The row data already exists: `serializeEmployee` emits `pmsRoles` and
`loginState`; `RoleEditor`'s whole-set PUT stays as-is. This is a new composition of shipped parts
plus one new column, not a new subsystem.

## Open questions

1. **Should the merged screen live at `/admin/access` or replace `/admin/roles` in place?** Proposing
   a new path so both old links can redirect and neither audience loses their bookmark.
2. **Should a platform admin see every employee, or only accounts?** Proposing: accounts always,
   employees only when they also hold an HR role — a platform admin has no §4.2 visibility claim on
   the org chart.
3. **Does `EDITOR` get removed from the enum later?** Not now (no migration, no risk). Worth a
   cleanup once telemetry shows zero rows carry it.
