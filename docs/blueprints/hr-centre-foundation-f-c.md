# Blueprint — HR Centre foundation, slice F-c (role builder and scoped access)

Scope: lib/rbac/**, lib/validations/rbac.ts, lib/pms/permissions.ts, lib/pms/actor.ts, lib/pms/org-tree.ts, lib/pms/employee-select.ts, lib/pms/cycle-notify.ts, lib/prisma/soft-delete-extension.ts, lib/prisma/recyclable.ts, app/api/rbac/**, app/api/employees/**, app/api/org/**, app/api/pms/**, app/api/users/**, app/api/kpi-change-requests/**, app/api/cycles/**, app/[locale]/(dashboard)/admin/**, app/[locale]/(dashboard)/people/**, components/rbac/**, prisma/schema.prisma, prisma/seed-foundation.ts, prisma/seed.ts

Status: SIGNED OFF as part of `docs/blueprints/hr-centre-foundation.md` (operator,
2026-10-26). Stories and acceptance criteria are the parent's **US-F3**
(AC-F3.1–AC-F3.4) and §3; scenarios are the parent's. This file records how the
slice was built and the coordinator's HIVE addendum folded into it.

## What this slice delivers

- Permission catalogue in code (`lib/rbac/catalogue.ts`), 14 actions over five
  modules; `AccessRole` (the blueprint's `Role` — renamed because `Role` is
  already the platform enum on `User.role`) and `RoleAssignment`
  (GROUP | COMPANY | DIRECTORATE | DEPARTMENT).
- Starter roles HR Super Admin / HRBP / Executive Viewer, created by the
  migration (with `pmsRoles` converted into Group assignments ONCE) and
  re-created idempotently by the seed only if missing (a deleted starter stays
  deleted).
- The 15 helpers in `lib/pms/permissions.ts` keep their names and call sites and
  answer from the actor's expanded grants; `resolveActor` loads assignments once
  per request. `Employee.pmsRoles` is read nowhere in the app (kept for a later
  drop; the local demo seed and the integration fixture still describe actors
  with it and mirror it into assignments).
- `/admin/roles`: role builder (ticks per module) and assignments, platform
  admins only — page redirects others to `/forbidden`, APIs use `withAdminAuth`.

## Coordinator addendum (HIVE port inventory), folded in

1. `RoleAssignment.validFrom` / `validUntil` (≤ 180 days, must end in the future)
   and `note`; an expired or not-yet-started assignment grants nothing — checked
   in the per-request query and again in memory.
2. Scope kinds are an extensible enum; ALL scope evaluation goes through
   `scopeCovers` in `lib/rbac/grants.ts`, and a module registers its own kind with
   `registerScopeResolver` (unknown kinds cover nothing).
3. `usersHoldingPermission(permission, subject, { limit })` in
   `lib/rbac/resolve.ts` — bounded "who holds P for S" (Performance's HR
   notifications now use it).
4. Last-administrator guard (`lib/rbac/guards.ts`) on role edit, role deletion,
   assignment removal (and login disable in F-d): refuses a change that leaves
   nobody holding `logins.manage` + `people.edit` for the whole group, and (F-d)
   nobody able to sign in as a platform admin.

## Build notes (decisions on the stated defaults)

- **Scope semantics this release.** `people.*` and `logins.manage` honour an
  assignment's scope: a Codeline-scoped HRBP sees and edits Codeline's people
  (directory, record, personal and ID fields). Performance (`perf.*`),
  `org.manage` and `imports.*` act org-wide in the existing code, so only a
  GROUP grant of them counts — a scoped grant fails closed rather than acting
  outside its scope. Scoped Performance is a later step.
- Editing the core record (`PUT /api/employees/[id]`) needs `people.edit` where
  the person is AND where they are moving to, plus `people.viewSalary` (the PUT
  replaces salary — no blind overwrite).
- Assignments attach to a login (`User`), so a platform admin with no employee
  record can still hold an HR role.

## Scenarios checked

- Every existing Performance contract test passes with actors read through the
  starter roles (AC-F3.4); a contract test also proves assignment-backed and
  legacy actors produce identical capabilities for every role combination.
- Role edits take effect on the next request (no cache); a cover assignment
  stops granting the moment it expires.
- Removing the only HR Super Admin assignment, stripping its permissions, or
  deleting an assigned role is refused with a sentence.
