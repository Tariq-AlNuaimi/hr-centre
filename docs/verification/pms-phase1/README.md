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

## 7. Not yet verified (and why)

- **Browser/visual QA and axe** — not run. The screens are built from the vetted
  `components/shared/*` primitives with logical properties throughout, but per
  `docs/rules/design.md` a visual claim is only valid with captures attached, and none were
  taken. `/design-qa` on the deployed URL is the next step, before HR review.
- **Live RBAC click-through** (`/manual-uat`) — the permission matrix is proven at the unit
  and query layer (19 contract tests, salary absent from the SELECT), but not yet by logging
  in as each of the four roles in a browser.
