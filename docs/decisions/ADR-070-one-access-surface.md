# ADR-070 — One access surface, and a platform role that tells the truth

**Status:** Accepted — implemented 2026-08-27 (the operator chose this shape explicitly: "collapse
the platform role to a checkbox · merge the two screens · blueprint first, then build · now, before
the demo". Touches the shape the API accepts for `role`, an Ask-before surface — CLAUDE.md)
**Date:** 2026-08-27
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-065 (the User/Employee split), ADR-069 (login provisioning and revocation)
**Blueprint:** `docs/blueprints/one-access-screen.md`

## Context

The operator, looking at `/users/new`: _"how come that i can add users to the platform and they have
the three roles viewer, or editor or admin, which doesn't align with the rest of the app"._

They were right, and measuring it made it worse than it looked.

| Value    | What it actually gated                                                                  |
| -------- | --------------------------------------------------------------------------------------- |
| `ADMIN`  | `/api/users`, `/api/recycling-bin`, `/api/audit-log` — and the sidebar entries for them |
| `EDITOR` | **Nothing.** `withEditorAuth` exists in `lib/api-helpers.ts` and is never called        |
| `VIEWER` | Nothing                                                                                 |

Every read of `User.role` in the product is `=== "ADMIN"` — three call sites in the UI, one wrapper
in `api-helpers`. So HR was asked to make a three-way choice the product read as two-way, in words
that appear nowhere in the specification (§4.1's vocabulary is HR_SUPER_ADMIN / HRBP /
EXECUTIVE_VIEWER, on a different table, by ADR-065). **A control that does not do what it appears to
do is worse than a missing control: the first teaches something false, the second teaches nothing.**

The second half is where it landed on a person. Authority was split across two screens that never
mentioned each other — `/users` (platform ADMIN) and `/admin/roles` (HR Super Admin). Neither was
wrong; ADR-065's split is right and this ADR keeps it. What was wrong is that answering _"what can
this person do?"_ meant visiting two screens, holding two vocabularies, and knowing that one of the
three values on the first was decorative.

## Decision

**1. The platform role is a boolean at the BOUNDARY, not just in the UI.**
`createUserSchema` / `updateUserSchema` (`lib/validations/user.ts`) no longer accept a `role` string
at all. They take `isPlatformAdmin: boolean`, and `roleForPlatformAdmin()` / `isPlatformAdminRole()`
map it to and from the stored enum in one place. The form is one checkbox naming exactly what it
grants: _"Platform administrator — can create and delete logins, restore records from the recycling
bin, and read the audit log"_, with a second line saying what it is **not** (§4.1 HR authority).

Narrowing the schema is what makes it real. A UI-only change would leave the API still accepting a
value nothing honours, and the API is the contract.

**2. The `Role` enum keeps all three values.** No migration, no risk. Existing `EDITOR` rows stay
valid and render as "Standard", which is what EDITOR has always meant in practice. What changed is
that the value can no longer be _granted_ — through the UI or the API. Retiring it from the enum is
a later cleanup once no row carries it.

**3. One screen: `/admin/access`.** `/users` and `/admin/roles` redirect to it (id-preserving for
`/users/<id>`), so bookmarks, the command palette's history and any handover document still work. It
is gated on the **union** — platform ADMIN _or_ HR Super Admin — because each governs one half of
what it shows.

**4. The half you do not govern is SHOWN, not hidden**, with the reason in it. An HR Super Admin
still cannot grant platform administration and a platform admin still cannot grant HR authority;
that boundary does not move. But a hidden section teaches nothing — an HR admin who cannot see that
platform administration exists will keep asking for it in the wrong place.

**5. One row where one row is possible.** `/api/users` now joins the linked employee and returns
`pmsRoles` alongside `isPlatformAdmin`, so the accounts table answers "what can this person do?" on
a single row. That join is safe _there_ specifically because that endpoint is already the most
privileged read in the app (`withAdminAuth`).

## Consequences

- `/users/new`'s dropdown is gone; there is one checkbox and a sentence.
- `GET /api/users` filters on `?platformAdmin=true|false` instead of `?role=`. The filter follows
  the field: the screen no longer offers three roles, so it no longer filters by three.
- A platform admin can see who the HRBP is before deleting their account. That is the point.
- The self-demotion guard on `PUT /api/users/[id]` still refuses; its message now names the thing
  being removed ("Cannot remove your own platform administrator access") instead of "admin role".
- `tests/contracts/api-auth.test.ts` gains a case asserting `withAdminAuth` refuses an `EDITOR`
  session — the property that matters now that EDITOR is ungrantable but still storable.

## What was NOT done, and why

**`withEditorAuth` was not deleted.** The blueprint proposed deleting it — dead authority that looks
live is how a future reader concludes EDITOR means something. Measuring the blast radius changed the
answer: it is **template machinery, not fork code**. `scripts/scaffold-entity.mjs --writes editor`
emits it, `scripts/rbac-matrix.mjs` resolves it, and two ESLint rules
(`no-bare-api-route.mjs`, `no-rate-limit-inside-auth.mjs` — the security floor, an Ask-before surface)
name it in their wrapper lists. Deleting it would break the scaffolder for every fork of this
template in order to close a gap the schema change already closes: EDITOR can no longer be granted.
The wrapper now carries a comment saying it gates nothing in this fork and pointing here, and the
contract test above pins the property. Revisit if the template's scaffolder drops the `editor` tier.

**`/api/employees` was not widened.** Putting `isPlatformAdmin` on the employee payload would have
let the People section show the platform half on every row — but that endpoint is visibility-scoped
and read by every signed-in employee, and platform-admin status is target information. It stays on
the admin-only account list. The cost is real and stated: an HR Super Admin who is not also a
platform admin sees that the section exists and who to ask, not the per-person answer.

**The two lists were not fused into one table.** The populations are different sets, not two views
of one set (ADR-065): the bootstrap admin on every deployment is a `User` with no `Employee`, and
most employees hold no platform authority. A single table would have to invent a row for one or hide
the other, and hiding the most privileged account in the system is the opposite of what an access
screen is for.

**The SSO seam — found open, then closed on the operator's call (amended 2026-08-27).**
JIT provisioning does not go through `createUserSchema`. On a federated first sign-up
`mapSsoRole()` (`lib/sso/role-map.ts`) reads `SSO_ADMIN_GROUPS` / `SSO_EDITOR_GROUPS` and
`adoptSsoRole()` (`lib/auth.ts`) writes the result straight to the row (ADR-069). So a group in
`SSO_EDITOR_GROUPS` could still stamp a new account `EDITOR`. That grants nothing — `withEditorAuth`
is never called — so it was misleading, not dangerous, which is why the original wording said the role
could not be granted "through the UI or the API" rather than "at all".

Found by the post-push breadth review, not by the diff-local pass: the SSO path is not in this
change's diff, which is exactly the kind of thing a diff-local review structurally cannot see.

Narrowing `mapSsoRole` is a role check and therefore Ask-before (CLAUDE.md), so it was recorded for
the operator rather than taken silently — **and they approved it.** `mapSsoRole` now returns
`ADMIN | VIEWER` and does not read `SSO_EDITOR_GROUPS`; `tests/contracts/sso-role-map.test.ts` asserts
the REFUSAL rather than deleting the old case, so restoring the branch fails a test. No effective
permission changed. The variable is left accepted-and-ignored rather than removed, so no deployment
needs a coordinated change; retire it at leisure. **The claim in this ADR is therefore now the strong
one: `EDITOR` cannot be granted by any path.**

## Alternatives considered

- **Expand the platform role to match §4.1** (the operator's other suggestion). Rejected: it would
  put HR authority on the login identity, which is exactly the merge ADR-065 separated the tables to
  prevent — and would hand every platform admin the power to make themselves an HR Super Admin.
- **Fold platform-admin into `/admin/roles`.** Rejected for the mirror-image reason: it would hand
  HR the ability to mint platform admins.
- **Leave the dropdown, relabel the values.** Rejected: renaming EDITOR does not make it gate
  anything. The problem was never the words.
