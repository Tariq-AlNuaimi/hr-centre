# UX review P1 — phase 4: a role builder admins can reason about

Scope: app/api/rbac/**, lib/rbac/service.ts, lib/rbac/diff.ts, lib/validations/rbac.ts, components/rbac/**, app/[locale]/(dashboard)/admin/roles/page.tsx, lib/sso/role-map.ts, app/api/users/platform-admins/route.ts, lib/pms/import/run.ts

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1".
Source: UX review shell/people R12 + R13. Re-verified on `main` at 83de9ac.

## Why

The role builder is a flat list of ~25 roles with Edit/Delete on each. An admin cannot see which
roles include an action, who holds a role, what an edit will change for its holders, or what one
person can actually do. "Starter" roles look locked but are editable. Three authority systems
(`User.role`, `Employee.pmsRoles`, RBAC) make "why can X see Y" hard to answer.

## Stories and acceptance criteria

- AC-1 (R12a) A List / Matrix switch: the matrix is roles (columns) × actions grouped by module
  (rows), read-only; editing stays in the role dialog.
- AC-2 (R12b) Each role shows "Assigned to N"; expanding it lists the holders with their scope
  (`GET /api/rbac/assignments?roleId=`, zod-bounded, ≤ 50 shown, "and N more").
- AC-3 (R12c) Editing a role shows, before saving, how many people hold it and what they gain and
  lose. Assigning a role shows what that person gains (actions they do not already hold).
- AC-4 (R12d) "View access as…": pick a person → their active roles with scopes and every action
  they hold, by module, with where (`GET /api/rbac/effective?userId=`, platform admins only, same
  active-window rule as `loadGrants`).
- AC-5 (R12e) Built-in roles say "Built-in (editable)"; Delete is disabled while a role is held
  (the server already refuses).
- AC-6 (R13) No runtime code reads `Employee.pmsRoles` from the database (a contract test scans
  `lib/`, `app/`, `components/`); stale comments now name role assignments. The column stays (one
  more release, then a migration drops it). `User.role = ADMIN` is already shown as "Platform
  administrator" (ADR-070).

## Scenarios

- Happy: the operator removes "people.viewSalary" from HR Manager → the dialog says "The 3 people
  who hold this role will change: Loses: See salaries" before Save.
- Worst: a non-admin calls `/api/rbac/effective` → 403 (`withAdminAuth`).
- Worst: an expired cover grant → not in the preview, exactly as it is not in the check.

## Architecture

Service `effectiveAccess` + filtered `listAssignments` (lib/rbac/service.ts) → two admin routes →
`RoleMatrix`, `RoleHolders`, `AccessPreview`, previews in `RoleDialog` / `AssignmentForm`; pure
`lib/rbac/diff.ts`.
