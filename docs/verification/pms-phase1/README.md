# Verification — PMS Phase 1 (org foundation & import layer)

Date: 2026-08-24 · Contract: `docs/blueprints/performance-management-system.md` ·
Governance: ADR-065, ADR-066

This change adds a **Restricted** data surface (basic salary, spec §4.5/§11.6), three new
models, and a migration that runs on every Vercel build. Per CLAUDE.md's "ceremony scales
with RISK", that earns an evidence artifact rather than just a commit message.

Everything below was **executed**, not reasoned about. Unit tests cannot reach a CHECK
constraint, a composite foreign key, or a recursive CTE — so those were run against a real
PostgreSQL 16 instance (`pg_ctlcluster 16 main start`, throwaway `pms_verify` database).

## 1. Automated gates

| Gate                                      | Result                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ship`                            | **green** (74s) — typecheck, lint, format, contract tests, component tests, hooks, scalability scan, licenses, blueprint gate, complexity, production build, gitleaks, npm audit |
| `tests/contracts/pms-import.test.ts`      | 30/30 pass                                                                                                                                                                       |
| `tests/contracts/pms-permissions.test.ts` | 19/19 pass                                                                                                                                                                       |
| Full contract suite                       | 232 pass / 0 fail                                                                                                                                                                |

## 2. Migration applies to a real database

`prisma migrate deploy` against an empty PostgreSQL 16 database applied all 9 migrations
including `20260824120000_pms_phase1_org_foundation`. This matters because `vercel.json`
runs `migrate deploy` on every build — an invalid migration is a failed deploy, and the
hand-written constraints in that file are not covered by `prisma validate`.

## 3. Database invariants — 12/12 behave correctly

Each row is an INSERT/UPDATE actually executed against the live schema.

| #   | Attempt                                       | Expected                              | Result                                      |
| --- | --------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| 1   | "Sales" under both RIHAL and TP               | allowed (§1.2 — distinct departments) | 2 rows ✅                                   |
| 2   | "Sales" twice under RIHAL                     | refused                               | `departments_entityId_name_key` ✅          |
| 3   | C-Level **with** a department                 | refused (§1.2)                        | `employees_department_xor_c_level_check` ✅ |
| 4   | Individual **without** a department           | refused (§1.2)                        | `employees_department_xor_c_level_check` ✅ |
| 5   | Employee in RIHAL pointing at a TP department | refused                               | `employees_department_entity_agree_fkey` ✅ |
| 6   | Valid C-Level (entity, no department)         | accepted                              | ✅                                          |
| 7   | Valid Individual (matching dept + entity)     | accepted                              | ✅                                          |
| 8   | Employee as their own manager                 | refused                               | `employees_manager_not_self_check` ✅       |
| 9   | Negative unpaid-leave days                    | refused (§11.5 feeds pro-ration)      | ✅                                          |
| 10  | Negative salary                               | refused (§11.3 feeds a payment)       | ✅                                          |
| 11  | Duplicate `odoo_id`                           | refused (§3.2 stable key)             | ✅                                          |
| 12  | Import issue severity `MAYBE`                 | refused                               | `import_row_issues_severity_check` ✅       |

Final state after the run: exactly the two valid employees, nothing else written.

## 4. Hierarchical visibility — the recursive CTE, on real data

Seeded fixture: 3 entities, 11 departments, 36 employees, reporting depth 4.

- Engineering Director (`1200`) resolves **7 descendants** in one query.
- A depth-3 descendant (`1200 → 1201 → 1202 → 1203`) is reachable — the case a
  per-level loop or a depth-1 join would miss. ✅
- **No cross-entity leakage**: no TP (`2xxx`) or CL (`3xxx`) employee appears in a RIHAL
  director's chain. ✅
- An individual contributor resolves **0 descendants**. ✅
- Headcount by entity: RIHAL=19, TP=8, CL=9.

Seed idempotency: running `seedPms` twice leaves 36 employees both times. ✅

## 5. Import pipeline — end-to-end against the live database

### 5a. The truncated-export case (§3.5 / Appendix A)

A sheet naming **2 of 36** employees — the exact shape of a filtered or truncated HR export.

| Check                                                                                                | Result |
| ---------------------------------------------------------------------------------------------------- | ------ |
| Preview reports 1 create, 1 update, **35 absent**                                                    | ✅     |
| **Nothing written at preview time** (36 → 36)                                                        | ✅     |
| After apply: 37 employees — one joiner added, **nobody removed**                                     | ✅     |
| An employee absent from the file (`3022`) is still `ACTIVE`, untouched                               | ✅     |
| §3.2 — a renamed person on a stable `odooId` updates **in place**, id unchanged, raised as a WARNING | ✅     |

This is the invariant the whole two-step design exists for: absence from a file produced
zero deletions and zero status changes.

### 5b. The §3.4 rejection rules

A sheet where every row breaks a different rule. All seven rejection rules fired, **0 creates
were planned**, and **nothing was written**:

`employee_id_missing`, `employee_id_duplicate`, `role_track_invalid`, `department_unknown`,
`department_ambiguous`, `manager_unknown`, `c_level_has_department`

### 5c. Restricted compensation (§4.5 / §11.6)

A salary raised from `1350` to `7777777` (deliberately unmistakable), imported and inspected
in the persisted `ImportBatch.previewJson`:

- Neither the old nor the new figure appears anywhere in the blob. ✅
- The change **is** recorded, as `{"field":"basicSalary","from":"[redacted]","to":"[redacted]"}` —
  HR sees _that_ pay changed without the preview surface carrying the figures. ✅
- No key named `salary` exists in the stored preview at all. ✅

> **A note on one FAIL that was not a defect.** The first version of this check searched the
> blob for the string `1300` and failed. Investigation showed `1300` is the `odooId` of a
> seeded employee (Huda Al-Mahrouqi) appearing in the absent list — a legitimate identifier,
> not a salary. The check was rewritten to use an unmistakable value. Recorded because a
> test that fails for the wrong reason is worth knowing about.

## 6. Two real defects this verification caught

Both were invisible to `tsc` and to the unit tests as first written:

1. **The Excel writer seam returned the wrong thing.** `writeXlsxFile(..., { buffer: true })`
   resolves to a handle exposing `toBuffer()`, not to a `Buffer`. The original cast asserted
   `Promise<Buffer>` and typechecked cleanly while returning an object — caught only by
   round-tripping real bytes. `tests/contracts/pms-import.test.ts` now asserts on bytes.

2. **The generated template's own header did not parse.** Header normalisation folded case
   and separators but not punctuation, so `Manager (Employee ID)` — the column the template
   itself emits — failed to map, silently dropping every reporting line on import. Fixed by
   normalising punctuation; the round-trip test now asserts all 11 columns map.

## 7. Live RBAC — the §4 permission matrix on real wire payloads

The app was run locally (Next dev against the Postgres above), one login created per role,
and `GET /api/employees` fetched with each session's real cookie. This asserts on the JSON
that actually crosses the wire, which is stronger than any rendering check for §4.5.

| Role                            | Rows returned          | `basicSalary` key present | The word "salary" anywhere in the payload |
| ------------------------------- | ---------------------- | ------------------------- | ----------------------------------------- |
| HR Super Admin                  | 36 (all)               | yes                       | yes                                       |
| HRBP                            | 36 (all)               | yes                       | yes                                       |
| Executive viewer (Ops Director) | 36 (all)               | yes                       | yes                                       |
| **Line manager** (Eng Director) | **8** (self + 7 chain) | **no**                    | **no**                                    |
| **Individual contributor**      | **1** (self only)      | **no**                    | **no**                                    |

§4.5 says line managers never see salary "even for their own direct reports". The field is
not hidden in the manager's response — it is **not in it**.

Negative paths, same sessions:

| Check                                                            | Expected                            | Got    |
| ---------------------------------------------------------------- | ----------------------------------- | ------ |
| Line manager reads an employee outside their chain               | 404 (not 403 — no existence oracle) | 404 ✅ |
| Line manager reads an employee inside their chain                | 200                                 | 200 ✅ |
| HR Super Admin reads that same employee                          | 200                                 | 200 ✅ |
| Individual creates an entity                                     | 403                                 | 403 ✅ |
| **HRBP** creates an entity (§4.1: configure is Super-Admin-only) | 403                                 | 403 ✅ |
| HR Super Admin creates an entity                                 | 201                                 | 201 ✅ |
| HR Super Admin creates a duplicate entity code                   | 409                                 | 409 ✅ |
| Invalid entity code format                                       | 400                                 | 400 ✅ |
| Individual downloads the import template                         | 403                                 | 403 ✅ |
| HRBP downloads the import template (preview is theirs)           | 200                                 | 200 ✅ |
| Unauthenticated `GET /api/employees`                             | 401                                 | 401 ✅ |

### A third defect this pass caught

A **malformed JSON request body returned 500 instead of 400**. `await request.json()` throws
on bad input and an unhandled throw in a route handler surfaces as a server error — but a body
the client failed to encode is the client's fault, and reporting it as 500 both misleads the
integrator and fills error monitoring with noise no operator can act on. Fixed by adding
`readJsonBody()` to `lib/api-response.ts` and using it on every PMS write route; re-verified
400 for a malformed body, 201 still for a valid one.

_(The 500 first showed up in a check whose own shell quoting had mangled the JSON — so the
test was wrong AND the behaviour was wrong. Both were fixed.)_

## 8. Screens — looked at, not assumed

Captured at 1440×900 against the seeded org (`docs/verification/pms-phase1/*.png`):

- **`01-hr-directory.png`** — HR view: 36 people, one primary action ("Import employees"),
  status filter, salary column present, C-Level rows showing "—" for department (§1.2).
- **`02-org-chart.png`** — the reporting tree five levels deep with logical-property indent
  guides, role-track badges, entity·department labels.
- **`03-import-preview.png`** — a real truncated 4-row export uploaded through the UI. Shows
  1 to create / 1 to update / **2 rejected** / **35 untouched**; each rejection with its row
  number and reason; the salary change rendered as `basicSalary: [redacted] → [redacted]`;
  and all 35 absent people listed under "Nothing happens to these people. A missing row is
  never treated as someone leaving."
- **`04-import-preview-dark.png`** — the same screen in dark mode; every token swaps, nothing
  hardcoded leaks through.

RTL was not captured because this fork is English-only (`project.config.json` `locales: ["en"]`),
so the Arabic path is inert by design. The screens are built entirely on logical properties
(`ms-*`, `ps-*`, `border-s-*`, flex) and `messages/ar.json` is at full key parity with `en.json`,
so enabling `ar` is a config change, not a rewrite — but that claim is untested until a fork
turns the locale on.

## 9. First-run bootstrap — the three guards, executed

ADR-065 keeps platform authority (`User.role`) and HR authority (`Employee.pmsRoles`) separate,
and `resolveActor` correctly resolves a `User` with no `Employee` to an actor who sees nothing.
The consequence on a fresh deploy is that the operator logs into their own new instance and the
PMS is empty with no way in — the fixture's HR Super Admin is an `Employee` row, and employees
have no password. `bootstrapAdminEmployee` in `prisma/seed-pms.ts` creates one employee record
for `SEED_ADMIN_EMAIL` carrying HR_SUPER_ADMIN. Nothing in `lib/pms/permissions.ts` learns to
trust `User.role`; this is a seeded row, not a rule change.

Run against the same throwaway PostgreSQL 16 database:

| #   | Guard                                                                                     | Expected                           | Result                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fresh fixture DB, `SEED_ADMIN_EMAIL` set                                                  | one record, HR_SUPER_ADMIN, linked | `BOOTSTRAP-ADMIN`, `{HR_SUPER_ADMIN}`, `userId` → the ADMIN user, `basicSalary` NULL ✅                                                |
| 2   | Re-seed unchanged                                                                         | silent no-op, headcount steady     | silent, 37 → 37 ✅                                                                                                                     |
| 3   | **Never mutate** — `pmsRoles` stripped to `{}` by hand, then re-seed                      | stays stripped                     | `{}` after re-seed, bootstrap silent ✅                                                                                                |
| 4   | **Real data present** — a non-fixture employee added, bootstrap row removed, then re-seed | refuses, loudly                    | 0 rows created; logged "headcount is 37, not the 36-person demo fixture … Grant HR roles deliberately instead of from a build step" ✅ |

Guard 3 is the one that matters: an import can never be overridden into HR Super Admin by a
redeploy. Guard 4 means the seam goes permanently silent the moment HR imports the real org — a
prototype needs a door, a system holding real appraisals must not grant HR authority from a
build step. Phase 2 owes an explicit HR-role administration screen, at which point this is deleted.

_(One incidental confirmation: the first attempt at guard 4 inserted a row with `entityId` and
`departmentId` transposed, and `employees_department_xor_c_level_check` refused it. The test was
wrong; the constraint was right. Re-run correctly, as recorded above.)_

## 10. Live deployment — probed, not assumed

`https://rihal-performance-management.vercel.app`, after the first production deploy:

| Check                            | Expected              | Got                  |
| -------------------------------- | --------------------- | -------------------- |
| `/`                              | redirect to login     | `307 → /en/login` ✅ |
| `/en/login`                      | 200                   | 200 ✅               |
| `/api/employees` unauthenticated | 401                   | 401 ✅               |
| `/api/internal/audit-purge`      | 401 (CRON_SECRET set) | 401 ✅               |

The last row also resolves the deploy script's own probe, which reported
`! Inconclusive audit-purge probe (HTTP 200 without the skip marker)` because it ran before the
build was live.

## 11. Accessibility — the axe pass, and the two defects it led to

This is the gap §12 previously listed as unverified and that `docs/findings-register.md`
scheduled as the first post-deploy action. Run with `@axe-core/playwright` (WCAG 2.0/2.1 A + AA)
at 1440×900, authenticated as an HR Super Admin, **light and dark**, against a local instance on
the demo fixture. Local rather than the deployed URL so the run needed no production credentials;
accessibility is a client-side property and the screens are the same build.

| Screen            | Light                  | Dark                   |
| ----------------- | ---------------------- | ---------------------- |
| People directory  | 0 violations (28 pass) | 0 violations (28 pass) |
| Org tree          | 0 violations (22 pass) | 0 violations (22 pass) |
| Admin → import    | 0 violations (25 pass) | 0 violations (25 pass) |
| Admin → org setup | 0 violations (26 pass) | 0 violations (26 pass) |
| Login             | 0 violations (21 pass) | 0 violations (21 pass) |

**Zero violations is not the same as zero problems**, and this run is the demonstration. The
login screen also returned five `color-contrast` results as **`incomplete`** — axe cannot score
text over a gradient background, so it declines to judge rather than failing. Chasing those down
produced two real defects:

### 11a. Two WCAG AA contrast failures, hidden behind "incomplete"

Measured directly: hide each text node, screenshot its box to photograph the pure background,
composite the text colour at its actual alpha, and take the worst pixel.

| Element                   | Before (worst case)                | Requirement | After  |
| ------------------------- | ---------------------------------- | ----------- | ------ |
| Monogram "R"              | 4.74:1 light / 4.96:1 dark         | 4.5:1       | 4.88:1 |
| Panel heading (30px bold) | 4.10:1 light / 5.29:1 dark         | 3:1 (large) | 4.88:1 |
| Value line (14px, /80)    | **3.17:1** light / **3.99:1** dark | 4.5:1       | 4.88:1 |
| Copyright (14px, /60)     | **2.26:1** light / **3.01:1** dark | 4.5:1       | 4.88:1 |

The gradient was `from-primary to-primary/80`, whose faded end blends toward the page
background — so the panel was **lightest exactly where the smallest text sat**. Raising the alpha
alone would not have fixed it: white at /80 on solid primary is 3.60:1. The fade and the
transparency both had to go. The panel is now solid `bg-primary` with full-opacity foregrounds,
which is what `brand.config.ts` asks for anyway ("ONE accent, solid — no gradient on product
surfaces"); hierarchy is carried by size and weight. axe's unresolved count went 5 → 1, and the
one that remains is the `aria-hidden` monogram, which axe skips as too-short content and which
measures 4.88:1.

Also fixed in the same pass: the panel and the page metadata still read **"Fullstack Next.js
application"** — a rebrand leftover sitting on the product's own login page.

### 11b. A pre-hydration submit put the password in the URL

The axe run's own login step failed, with the credentials visible in the address bar. That was
not a test bug. A `<form>` whose only submit path is a React `onSubmit` handler still submits
**natively** if the user gets there before hydration, and a native submit on a form with no
`method` is a **GET** — so the values land in the URL, in browser history, and in any `Referer`
the next navigation sends.

Reproduced deliberately with a 900 ms delay on script delivery:

```
http://…/en/login?email=victim%40example.com&password=not-a-real-password-probe
```

Same shape on three more forms: `reset-password` (worse — a new password beside the reset
token), `forgot-password` (an email), and `components/users/UserForm.tsx`.

Fixed with `method="post"` on all four, so even a submit that slips past the gate carries values
in a body rather than a URL, plus the submit button gated on a `hydrated` flag on the two
password forms. The same reproduction now ends on a clean `/en/login`, and the full authenticated
axe pass still logs in normally afterwards.

Both defects are template-authored surfaces, so **every fork of this template carries them**.
Recorded in `docs/findings-register.md` with the upstream fix owed.

## 12. Post-push senior review — two real defects, both fixed

A `senior-code-reviewer` breadth pass ran against `main` after the deploy. It confirmed the
parts this document already evidenced (salary never reaching an unentitled payload; the
recursive CTE parameterised, depth-capped and soft-delete-aware; no employee-delete path
anywhere in the shipped surface) and found two genuine defects in the import layer. Both were
reproduced independently before fixing, and both are now pinned by contract tests.

### 12a. Apply confirmed the shape of a plan, not its contents

`applyImport` compared three integers — `rowsCreated`, `rowsUpdated`, `rowsRejected` — against
the reviewed batch. Two different sheets with one create each produce identical counts, so a
substituted file was written as though it were the reviewed one. The two-step flow's entire
purpose is "the operator confirms exactly what they were shown", and that was aspiration.

The trigger is mundane rather than adversarial: re-uploading a newer export at the confirm step
that happens to add the same number of people.

Fixed with a `planDigest` — SHA-256 over every field the plan would write, sorted by `odooId` so
file order is not content — persisted in `previewJson` at preview and re-checked at apply.

| Scenario, run against PostgreSQL 16                                         | Result                                        |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| Preview `export-v1.xlsx` (1 create), confirm with a different 1-create file | **refused** ✅                                |
| Headcount after that refusal                                                | 37 → 37, substituted person not written ✅    |
| Re-confirm with the correct file                                            | applies, 1 created ✅                         |
| Same rows in a different order                                              | same digest — reordering is not a new plan ✅ |
| Salary changed, nothing else                                                | different digest ✅                           |

The count check is kept alongside the digest: they catch different things. Counts catch the org
moving under a plan (another admin adding someone turns a create into an update); the digest
catches a different file.

Salary is inside the digest deliberately. It is the most sensitive thing an import can change,
and a one-way hash costs no confidentiality against anyone who can already read the column.

### 12b. A duplicate email passed preview, then rolled back the whole batch

`Employee.email` is `@unique`, but nothing checked it — not within the file, not against the
database. A sheet with a repeated address (a typo, or a leaver's address reused for a new hire)
previewed as **0 rejected**, then threw a raw P2002 inside the batch transaction, rolling back
**every other create and update in the file** and surfacing as an opaque 500. That is §3.4's
promise exactly inverted.

Fixed with two batch-level rules, `email_duplicate` and `email_in_use`. Verified end to end: a
two-row file whose second row collides with seeded employee `1000` now previews as

```
1 create, 1 reject
   row 3: email_in_use — Email "salim.alharthy@rihal.example" already belongs to employee 1000.
```

applies the legitimate row, and leaves the colliding one unwritten — no batch-wide rollback.

A row keeping its OWN email on re-import is correctly not a clash: that is §3.2's stable-key
update path.

### 12c. One documentation defect

The blueprint and the `ImportPreview` doc comment both claimed the confirm step "re-reads the
reviewed diff rather than re-parsing an uploaded file". It cannot — the rows carry Restricted
salary and are deliberately not persisted. Both corrected, and the blueprint now explains what
actually enforces the guarantee.

## 13. Still not verified

- **The apply step through the browser UI.** Apply was exercised end-to-end against the
  database (§5a above) and the confirm button was rendered and enabled, but the final click
  was not taken in the browser session.
- **Visual regression baseline.** The four captures in this directory are evidence, not a
  committed `baseline/` set, so `npm run visual-regression` has nothing to diff against yet.
- **RTL.** This fork is English-only (`project.config.json` `locales: ["en"]`), so the Arabic
  path is inert by design — see §8.
