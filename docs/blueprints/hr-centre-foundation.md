# Blueprint — HR Centre foundation (step 1 of 4)

Scope: prisma/schema.prisma, prisma/seed-foundation.ts, prisma/seed.ts, lib/org/**, lib/rbac/**, lib/people/**, lib/pms/permissions.ts, lib/pms/actor.ts, lib/pms/org-tree.ts, lib/pms/employee-select.ts, lib/pms/import/**, lib/crypto/**, lib/validations/org.ts, lib/validations/people.ts, lib/validations/rbac.ts, lib/validations/login.ts, app/api/org/**, app/api/people/**, app/api/rbac/**, app/api/logins/**, app/api/employees/**, app/api/imports/**, app/[locale]/(dashboard)/admin/**, app/[locale]/(dashboard)/people/**, app/[locale]/(dashboard)/org/**, app/[locale]/(auth)/change-password/**, components/org/**, components/people/**, components/rbac/**, components/layout/AppSidebar.tsx, messages/en.json

Status: DRAFT — awaiting operator sign-off (2026-10-26)

## Problem & outcome

HR Centre is Rihal's single HR system (decision recorded in the proposal agreed by
HR, 2026-10-26). It starts from the Performance app, which already holds the only
real employee record (`Employee`, keyed on `odooId`) with managers, departments,
Excel import, leavers and transfers. The other HR apps move into it as modules in
three later steps (joiners/movers/leavers → HR tickets → hiring).

Before any module can move in, the core every module shares must be right:

1. **The organisation as Rihal actually is** — Group (umbrella) → company →
   directorate (Rihal only) → department → team → employee. Performance today
   models only company → department.
2. **A full employee record** — job, contract, contact, personal details and ID
   documents, not just what Performance needed.
3. **Highly customised access control** — admins build roles from a catalogue of
   actions and assign them to people for a scope (whole group, a company, a
   directorate, a department). Today HR authority is three hard-coded roles.
4. **Logins for HR and managers** while sign-in is email + password (SSO comes
   later). Ordinary employees do not log in until SSO.
5. **Three ways in for employee data** — Excel import first, HR typing as a
   second path, and an Odoo API connection later (designed for, not built here).

**Outcome:** HR can load the real org and people, decide precisely who may do
what, and give managers a login — and the Performance module keeps working on top
of it unchanged in behaviour.

## Decisions taken with the operator (2026-10-26)

| Question                   | Decision                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Org levels                 | Group (umbrella only, no people of its own) → company → directorate (only Rihal has them) → department → team → employee |
| Employee data source       | Excel import first; HR can also type/edit; Odoo API later                                                                |
| First login                | HR only, plus managers (to run the performance cycle). Everyone else waits for SSO                                       |
| Manager password handover  | One-time temporary password shown once to HR; must be changed at first login                                             |
| Access control shape       | Role builder (tick actions per module) + assignment with a scope                                                         |
| Existing Performance roles | Shipped as editable starter roles (HR Super Admin, HRBP, Executive Viewer)                                               |
| Who manages roles          | Platform admins only (`User.role = ADMIN`); HR cannot change its own powers                                              |
| Employee fields            | Job & contract, contact, personal, **and ID documents** (civil ID, passport)                                             |

## Market scan

Role-and-scope access is the norm in mature HRIS, which is why it was chosen over
per-person ticks:

- **Workday** — security groups (role-based, assigned to positions) constrained
  to supervisory/company organisations: the role says _what_, the org says _where_.
- **Odoo HR** — access groups per app (Officer / Manager / Administrator) plus
  record rules by company; only company-level scope out of the box.
- **BambooHR / HiBob** — customisable access levels with field-level visibility
  (e.g. compensation, personal data) scoped to "all employees", "my reports" or a
  filtered group.
- **Common anti-feature:** per-person permission grids — unmanageable past a
  handful of users and impossible to audit. Not offered here.

What HR Centre adopts: catalogue of actions per module, roles as named bundles,
assignments with an org scope, field-level gates for Restricted data (salary, ID
documents), and line-manager authority derived from reporting lines (not a role).

## Architecture

### 1. Organisation

```
(Group — not a table; "All companies")
OrgEntity (company)          existing: code RIHAL|TP|CL, name
  └─ Directorate             NEW: entityId, name   — optional level (only Rihal uses it)
      └─ Department          existing + directorateId? (must be in the same company)
          └─ Team            NEW: departmentId, name
              └─ Employee    existing + teamId? (team must be in the employee's department)
```

- A department may sit directly under a company (TP, CL) or under a directorate
  (Rihal). The "same company" rule is enforced in the service and by a DB CHECK
  via trigger, like the existing department↔entity invariant.
- `Employee.departmentId` stays the anchor every existing Performance query uses;
  `teamId` is an optional refinement, so nothing downstream changes meaning.
- Admin screens: Companies (rename only; codes are import keys), Directorates,
  Departments, Teams — create, rename, move, retire (soft-delete, refused while
  people are assigned).

### 2. Employee record

New fields on `Employee` (all optional; the import and form fill them):

| Group          | Fields                                                                                                               | Class          |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- |
| Job & contract | jobTitle, grade, contractType (PERMANENT, FIXED_TERM, INTERN, PART_TIME, SECONDMENT), probationEndDate, workLocation | Internal       |
| Contact        | workPhone, personalEmail, personalPhone                                                                              | Confidential   |
| Personal       | dateOfBirth, gender, nationality                                                                                     | Confidential   |
| ID documents   | civilIdNumberEnc, civilIdExpiry, passportNumberEnc, passportExpiry                                                   | **Restricted** |

- ID numbers are **encrypted at rest** with the existing AES-GCM field encryption
  (ADR-067), bound to `odooId` as AAD like salary, under a separate
  `ID_ENCRYPTION_KEY` so the two can rotate independently. Expiry dates are not
  encrypted (they drive "expiring soon" lists).
- Added to `SCRUB_FIELDS` (audit never stores them) and the restricted-export
  rule, in the same commit.
- Visible only with the `people.viewIdDocuments` permission; personal fields only
  with `people.viewPersonal`. The select is built from permissions, exactly like
  salary today (`lib/pms/employee-select.ts`).

### 3. Access control (RBAC)

```
Permission catalogue (code, lib/rbac/catalogue.ts)
  module.action  e.g. people.view, people.edit, people.viewSalary,
                 people.viewPersonal, people.viewIdDocuments, org.manage,
                 imports.run, logins.manage, perf.runCycle, perf.configure,
                 perf.calibrate, perf.exportMaster, perf.viewReports, …
Role            NEW: name, description, permissions[], isStarter, deletedAt
RoleAssignment  NEW: userId, roleId, scopeType (GROUP|COMPANY|DIRECTORATE|DEPARTMENT),
                     scopeId?, grantedById, note
```

- An assignment means "this person can do these actions for people inside this
  scope". GROUP = everyone. Several assignments add up ("most access wins").
- **Line-manager authority is not a role** — it stays derived from reporting
  lines, as in Performance today.
- **Only platform admins** (`User.role = ADMIN`) can create/edit roles and
  assign them. Every change is audited.
- **Starter roles** reproduce today's behaviour exactly: HR Super Admin (all
  perf + people + org actions, GROUP), HRBP (run the cycle, no configure),
  Executive Viewer (read-only org-wide, incl. salary as today). Admins may edit or
  delete them.
- **How Performance switches over without a rewrite:** `resolveActor` loads the
  actor's assignments once per request and expands them to a permission set with
  scopes. The 15 helpers in `lib/pms/permissions.ts` (`isHr`, `canConfigure`, …)
  keep their names and call sites (33 files) but answer from that set instead of
  `pmsRoles`. Org-wide visibility becomes "the union of my scopes"
  (`visibleEmployeeIds`). `Employee.pmsRoles` is migrated into assignments, then
  dropped in a later release once nothing reads it.

### 4. Logins (until SSO)

- HR (with `logins.manage`) clicks **Create login** on an employee: HR Centre
  generates a temporary password, shows it **once**, stores only its hash, and
  sets `User.mustChangePassword`. First sign-in forces a change before anything
  else loads.
- Eligible: anyone holding an HR role assignment, and line managers (anyone with
  direct reports). The button is hidden for others and the API refuses them.
- **Reset login** issues a new temporary password the same way; **Disable login**
  revokes it. Leavers lose their login automatically (existing departure flow).
- The import keeps creating passwordless login records (ADR-069) so SSO can link
  to them later; a passwordless record cannot sign in.

### 5. Getting people in

- **Import (first):** the existing two-step preview/apply import gains the new
  columns, directorate and team. Unknown directorates/teams are reported in the
  preview, never auto-created silently.
- **Typing:** People → Add employee / Edit, with zod validation and the same
  invariants as the import (one writer: `lib/people/write.ts`, shared by import,
  form and the future Odoo sync).
- **Odoo API (later):** out of this step. The design keeps `odooId` as the key
  and routes every write through the same writer so the sync is a third caller,
  not a third implementation.

### Where state lives

| State                                        | Where                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Org structure, employees, roles, assignments | Postgres (audited, soft-deleted)                                        |
| Permission catalogue                         | Code (`lib/rbac/catalogue.ts`), versioned with the routes that check it |
| Temporary passwords                          | Hash only, on `User`; plaintext exists in one response body, once       |
| ID numbers, salary                           | Encrypted columns; keys in Vercel env, backed up by the operator        |

## User stories & acceptance criteria

**US-F1 Org structure.** As an HR admin, I set up Rihal's real structure.

- AC-F1.1 I can create directorates under Rihal and departments under a
  directorate or directly under a company; a department can't be moved to another
  company while it has employees.
- AC-F1.2 I can create teams under a department; an employee's team must belong
  to their department (UI and API both refuse otherwise).
- AC-F1.3 Retiring a unit with people in it is refused with a count.

**US-F2 Employee record.** As HR, I keep a complete record of each employee.

- AC-F2.1 All fields above can be imported and edited; validation messages say
  which field and why.
- AC-F2.2 Civil ID and passport numbers are unreadable in the database and in
  audit rows; only people with `people.viewIdDocuments` in scope see them.
- AC-F2.3 Personal fields are hidden without `people.viewPersonal`; salary rules
  are unchanged.

**US-F3 Role builder.** As a platform admin, I control exactly who can do what.

- AC-F3.1 I can create a role by ticking actions grouped by module, rename it,
  and delete it (refused while assigned, with the list of holders).
- AC-F3.2 I can assign a role to a user for Group, a company, a directorate or a
  department; the person sees and acts on employees inside that scope only.
- AC-F3.3 Non-admins cannot open the role screens or call their APIs (403).
- AC-F3.4 With only the starter roles assigned the way `pmsRoles` were, every
  existing Performance contract test passes unchanged.

**US-F4 Logins.** As HR, I give HR staff and managers a login.

- AC-F4.1 Create login shows a temporary password once; reloading the page never
  shows it again.
- AC-F4.2 First sign-in with it forces a new password before any other page.
- AC-F4.3 Create login is refused for anyone who is neither in an HR role nor a
  line manager.

**US-F5 People data in.** As HR, I load and maintain people.

- AC-F5.1 An import with directorates, teams and the new columns previews every
  change and issue before applying.
- AC-F5.2 Adding one employee by form produces exactly what the import would.

## Scenarios

**Happy path.** Admin signs in → builds the org (3 companies, Rihal's
directorates, departments, teams) → imports the employee sheet → assigns Muna "HR
Super Admin" for Group and an HR officer "HRBP" for Codeline → HR creates logins
for HR staff and line managers → managers sign in, change password, see only
their team → the performance cycle runs as before.

**Worst paths.**

- An HR officer scoped to Codeline opens a Rihal employee by URL → 404, not 403
  (no existence leak), and no salary/ID data in any response.
- A role is edited to remove `perf.runCycle` mid-cycle → the next request
  reflects it; no cached permission survives the request.
- The ID key is missing in production → reads/writes of ID numbers fail closed
  with a clear message; the rest of the record still works.
- An import names a team under the wrong department → preview flags the row;
  apply refuses it.
- The last platform admin tries to remove their own admin role → refused.
- A temporary password is intercepted after first use → it no longer works
  (changed at first login; reset invalidates the old one).

## Five Pillars

- **Speed:** one assignments query per request, expanded in memory; org tree
  queries stay bounded (existing recursive CTE, depth 32).
- **Secure:** RBAC is server-side on every route; Restricted fields encrypted,
  scrubbed from audit and exports; role admin limited to platform admins;
  temporary passwords hashed and single-view.
- **Maintainable:** existing helper names kept; one writer for import/form/Odoo;
  catalogue in code next to the checks.
- **Scalable:** lists paginate; scope filter applied in the query, not after.
- **High-quality:** honest empty states ("No directorates yet — Rihal only"),
  explicit refusal messages, axe-clean forms.

## Delivery slices (each ends green, reviewed and deployed)

1. **F-a Org structure** — Directorate, Team, Department.directorateId,
   Employee.teamId; admin screens; import columns.
2. **F-b Employee record** — new fields, encrypted ID documents, form, import
   columns, field-level visibility.
3. **F-c RBAC** — catalogue, Role, RoleAssignment, starter roles, role builder
   screens, Performance helpers switched over, pmsRoles migrated.
4. **F-d Logins** — create/reset/disable, forced change at first sign-in.
5. **F-e HR Centre shell** — navigation by module, People directory and employee
   record page (the base later modules add their tabs to).

## Ask-before surfaces this step touches (approval sought with this blueprint)

`prisma/migrations/**` (new tables/columns), `lib/prisma/audit-extension.ts`
(SCRUB_FIELDS), `lib/auth.ts` (forced password change), **role checks**
(replacing `pmsRoles` with assignments), and a new env var `ID_ENCRYPTION_KEY`.

## Open questions (for HR)

1. Company codes RIHAL / TP / CL — confirm or replace.
2. Rihal's directorate list, and every company's departments and teams.
3. Should line managers see their team's personal fields (phone, date of birth)?
   Default: no — job and contact only.
4. How long must ID document numbers be kept after someone leaves?
5. Who are the platform admins besides Tariq (e.g. IT)?
