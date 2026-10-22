# Blueprint — reset the test dataset (dummy-data tool)

Scope: prisma/dummy-data.ts, prisma/dummy-data-cli.ts, docs/runbooks/reset-dummy-data.md

**Status:** approved to build (operator, 2026-10-22 — the five-part guard, random
per-role passwords printed once, and the keep rule all confirmed; scope then widened from
"remove test employees" to "remove all people, departments, entities and cycles, keeping the main
admin and HR").

## Problem

An import of test employees left the deployment unusable: the fake people are enrolled
participants who can never be scored, so §10.7's gate blocks calibration, publish and the 360
forever. Marking them LEAVER did nothing — that revokes a login and touches no participant row.
The operator wants to start over from a small, realistic dataset.

## Decisions

| Question                        | Answer                                                           | Why                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People / departments / entities | **Soft delete** (`deletedAt`) — reversible via the Recycling Bin | All three are in `SOFT_DELETE_MODELS`, and the bin is documented as being "for ERRONEOUS records only", which a test import is. A soft delete is an UPDATE, so it also sidesteps every FK `RESTRICT` below. |
| Cycles                          | **Hard delete.** Irreversible, and the operator approved it      | `PerformanceCycle` carries `deletedAt` columns but is NOT in `SOFT_DELETE_MODELS` and **no reader filters on them** — setting it would be a no-op that merely looks reversible. See "what is irreversible". |
| Logins                          | **Untouched**                                                    | `users → employees` is `SET NULL` and `users → audit_logs` is `SET NULL`, so removing employees cannot take a login or an audit row with it. Nobody is locked out.                                          |
| Audit log                       | **Untouched**                                                    | No FK from `audit_logs` to `employees` at all. The tool's own writes add new rows (attribution for the cleanup); nothing existing is read or deleted.                                                       |
| Re-seed identity                | **Namespaced `DUMMY-` odooIds, upserted**                        | Unique indexes ignore `deletedAt`: a soft-deleted row keeps its `odoo_id`, `email`, entity `code` and `(entityId, name)`. Upserting inside a reserved namespace is what makes the tool re-runnable.         |
| Passwords                       | **Random per run, one account per role track, printed once**     | `seed-pms.ts` deliberately provisions passwordless logins — "seeding thirty-seven shared passwords to make a demo convenient is the one thing this must not do". Five accounts, generated, never committed. |

## The guard — five parts, all required

Operator-approved. No data signal can distinguish a test deployment from a live one (both have
import batches and many employees), so the guard is an explicit declaration, not an inference.

1. **CLI only.** Not an API route, not reachable from the app, needs `DATABASE_URL` in hand.
2. `project.config.json` → `"dummyData": { "resetAllowed": true }`. `/handoff` flips this to false
   at go-live and it is reviewable in git.
3. `DUMMY_DATA_RESET` env var set to the exact sentinel `yes-wipe-and-reseed`.
4. **Refuses outright if any cycle has `published: true`.** Released results mean real people have
   seen them — the one honest data signal for "this is live".
5. `--apply` plus `--confirm <N>` matching the number of employees it will remove. Dry run is the
   default; with no flags it writes nothing.

## What is irreversible

Everything attached to a cycle, via `ON DELETE CASCADE` (walked from the live foreign keys, and a
bare `DELETE` was tested inside a transaction and rolled back — the cascade succeeds, no ordering
needed):

```
performance_cycles
├── cycle_stages, cycle_publications, calibration_targets
├── entity_scores, department_scores, compliance_events, projects
├── cycle_participants
│   ├── kpis ──► kpi_ratings, kpi_evidence, kpi_versions
│   ├── sign_offs
│   └── kpi_change_requests ──► their edits
├── score_runs ──► employee_scores ──► calibration_adjustments
├── employee_assignment_periods
└── three_sixty_cycles
    ├── assessment_templates ──► template_questions
    └── assignments ──► assignment_responses
```

Nothing else references a cycle, so no orphans are left behind.

## The keep rule (operator-confirmed)

An employee is kept when ANY holds:

- their linked `User` has a `passwordHash` — they can sign in today;
- they hold `HR_SUPER_ADMIN` or `HRBP`;
- their linked `User` has `role = ADMIN`;
- their name matches **Muna Adam** or **Tariq Al-Naaimi**.

Everyone else is soft-deleted. The other four testers are deliberately not kept.

## The dataset — 24 people

| Entity       | Department  | People | Tracks                                      |
| ------------ | ----------- | ------ | ------------------------------------------- |
| Rihal (demo) | Engineering | 9      | Director, Manager, Lead, 6 Individuals      |
| Rihal (demo) | Delivery    | 6      | Manager, Lead, 4 Individuals                |
| TP (demo)    | Operations  | 7      | Director, Manager, Lead, 4 Individuals      |
| —            | none        | 2      | C-Level ×2, one per entity (§8.3 — no dept) |

Every department is ≥5, so §10.4's curve-eligibility threshold can be exercised in all three.
Every non-C-Level has a manager; the smallest department is 6, so everyone has their manager plus
≥2 same-department peers available as 360 raters. Salaries vary across bands.

Four edge cases, one person each: a **new joiner** inside 6 months (`dateOfJoining` — exercises
§11.7's eligibility gate), **unpaid leave** (`unpaidLeaveDays`, §3.3/§11.5), a **mid-cycle
transfer** (two `EmployeeAssignmentPeriod` rows, §12.3), and a **leaver** (`status = LEAVER` with a
`lastWorkingDay`, §12.1).

One fresh cycle, with all three stage windows open at once and deadlines well out, so every stage
can be walked immediately in any order rather than waiting for a window or hitting a §5.4 lock.

## Scenarios

### Happy path

Tariq exports the connection string, runs the dry run, sends the operator the printed list, and on
approval re-runs with `--apply --confirm <N>`. The tool reports what it removed and prints five
logins once.

### Worst paths

| What happens                                 | What the tool does                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Run against a live deployment                | Refused by the guard — the config flag, the sentinel and the published-cycle check all have to agree.       |
| `--apply` with a stale `--confirm` count     | Refused. The number is re-derived at apply time, so a dataset that changed since the dry run stops the run. |
| Run twice                                    | Idempotent: the wipe is a no-op second time, and the re-seed upserts inside the `DUMMY-` namespace.         |
| The one HR account is itself a test employee | Refused before any write — removing the last HR Super Admin would lock the deployment out of its own cycle. |
| A cycle has published results                | Refused. Guard 4.                                                                                           |
| Someone restores the old people from the bin | Supported — that is the point of using soft delete. The cycles do not come back, and the tool says so.      |

## Open questions

1. **Restoring from the bin after a re-seed** puts the old people back alongside the dummy ones. The
   bin has no bulk restore, so this is a row-at-a-time undo. Acceptable for test data; worth
   knowing before relying on it.
2. The tool does not re-create the §8.4 Strategy scores or run the 360 — those are HR's acts in the
   product, and seeding them would hide the steps the dataset exists to let someone exercise.
