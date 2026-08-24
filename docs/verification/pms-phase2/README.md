# Verification — PMS Phase 2a (cycle, stages, hard locks, HR-role administration)

Date: 2026-08-24 · Contract: `docs/blueprints/performance-management-system.md` (Phase 2 section)
· Spec: §2, §4.1, §5.4, §5.5, §5.6, §8.3

Everything below was **executed**. The spec text was re-read from the source document for this
phase, so the clause references are quotations rather than reconstruction.

## 1. Automated gates

| Gate                                | Result                    |
| ----------------------------------- | ------------------------- |
| `npm run ship`                      | **green** (62s), 22 gates |
| `tests/contracts/pms-cycle.test.ts` | 12/12 pass                |

## 2. Migration applies, and Phase 1's invariants survive it

`prisma migrate deploy` against an empty PostgreSQL 16 database applied all ten migrations.

**Three statements were removed from the generated diff before it was committed.**
`prisma migrate diff` compares the database against the _Prisma schema_, and the schema cannot
express a composite foreign key — so Phase 1's hand-written objects read as drift and the
generator proposed dropping them:

| Proposed by the generator                                | Why it was removed                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DROP CONSTRAINT employees_department_entity_agree_fkey` | This **is** §1.2's agreement invariant — an employee in RIHAL cannot point at a TP department                  |
| `DROP INDEX departments_id_entity_key`                   | The constraint above depends on it; Postgres refuses to drop it first                                          |
| `DROP TABLE document_embedding`                          | Template-inherited, unrelated to Phase 2; dropping a table is not a side effect a cycle migration should carry |

Verified after the Phase 2 migration ran: the constraint is present (1), the index is present (1),
and `document_embedding` still exists (1). The migration file carries a comment explaining this,
because the generator will propose all three again on every future phase.

## 3. Database invariants — 13/13 behave correctly

Each row is an INSERT or UPDATE actually executed against the live schema.

| #   | Attempt                                      | Expected                             | Result                                          |
| --- | -------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| 1   | Cycle for year 20027 (a typo)                | refused                              | `performance_cycles_year_range_check` ✅        |
| 2   | Stage whose deadline precedes its open       | refused (§5.4)                       | `cycle_stages_window_ordered_check` ✅          |
| 3   | Valid stage                                  | accepted                             | ✅                                              |
| 4   | 45-day grace window                          | refused (§5.5)                       | `cycle_stages_grace_days_range_check` ✅        |
| 5   | Two GOAL_SETTING stages in one cycle         | refused (§2 — three touchpoints)     | `cycle_stages_cycle_id_kind_key` ✅             |
| 6   | KPI weightage of 150                         | refused (§5.2)                       | `kpis_weightage_range_check` ✅                 |
| 7   | KPI with a whitespace-only descriptor        | refused (§5.2 — six texts)           | `kpis_texts_not_blank_check` ✅                 |
| 8   | Valid KPI at 60.50                           | accepted                             | ✅                                              |
| 9   | Participant approved-at with no approver     | refused (§5.1 — the lock is one act) | `cycle_participants_approval_complete_check` ✅ |
| 10  | Participant fully approved                   | accepted                             | ✅                                              |
| 11  | Two EMPLOYEE signatures on one participant   | refused (§5.1)                       | `sign_offs_participant_id_party_key` ✅         |
| 12  | Compliance event with `missed_by_hours = -5` | refused (§5.6)                       | `compliance_events_missed_by_nonneg_check` ✅   |
| 13  | The same compliance event written twice      | refused — sweep idempotency          | `compliance_events_..._key` ✅                  |

Final state after the run: exactly the valid rows — 1 stage, 1 KPI, 1 sign-off, 1 event, 1 cycle.

## 4. Cycle lifecycle — live wire payloads

Run against the seeded 37-person fixture with a real HR Super Admin session.

| Request                                       | Expected | Got                                   |
| --------------------------------------------- | -------- | ------------------------------------- |
| `POST /api/cycles` with all three touchpoints | 201      | 201 — DRAFT, 3 stages ✅              |
| `POST` with ONE touchpoint                    | 400      | 400 ✅                                |
| `POST` a duplicate year                       | 409      | 409 ✅                                |
| `PUT status=OPEN`                             | 200      | 200 — **37 participants enrolled** ✅ |
| `PUT status=OPEN` a second time               | 409      | 409 — the lifecycle is one-way ✅     |
| `PUT stages` — HR extends a deadline (§5.5)   | 200      | 200 ✅                                |
| `PUT stages` — deadline before the open       | 400      | 400 ✅                                |
| `PUT status=CLOSED`                           | 200      | 200 ✅                                |
| `PUT stages` on a CLOSED cycle                | 409      | 409 ✅                                |
| Reopening a CLOSED cycle                      | 409      | 409 ✅                                |

## 5. §4.1 authority — who may run a cycle, and who may grant HR roles

| Actor / request                                             | Expected | Got                     |
| ----------------------------------------------------------- | -------- | ----------------------- |
| Line manager `POST /api/cycles`                             | 403      | 403 ✅                  |
| Executive viewer `POST /api/cycles` ("Nothing (read-only)") | 403      | 403 ✅                  |
| Line manager `GET /api/cycles` (deadlines are public)       | 200      | 200 ✅                  |
| Line manager `PUT .../pms-roles`                            | 403      | 403 ✅                  |
| HR Super Admin grants HRBP                                  | 200      | 200 — `["HRBP"]` ✅     |
| An invalid role name                                        | 400      | 400 ✅                  |
| HR Super Admin revokes it again                             | 200      | 200 — `[]` ✅           |
| **HR Super Admin revokes their OWN Super Admin**            | 409      | 409 ✅                  |
| …and still holds it afterwards                              | yes      | `["HR_SUPER_ADMIN"]` ✅ |

The self-revoke guard is not paternalism: `HR_SUPER_ADMIN` is the only role that can grant
`HR_SUPER_ADMIN`, so the last one revoking themselves would leave an organisation whose salary
data nobody can administer and whose only recovery is a database edit. Revoking _someone else_ is
allowed, including the last one — that is a decision with a person behind it, which is what this
endpoint exists to record.

## 6. What this retires

`bootstrapAdminEmployee` in `prisma/seed-pms.ts` granted `HR_SUPER_ADMIN` from a **build step**,
as a deliberate prototype stopgap with a stated expiry (Phase 1 evidence §9). This is the expiry:
HR authority is now granted by a person, to a person, on the record, through the audit trail. The
seed bootstrap still runs on a fixture-only database so a fresh deploy has a first way in, and
still refuses the moment real org data is present.

## 7. Still not verified in 2a

- **Screens.** 2a ships the API and domain layer; the HR cycle-admin and role-admin screens land
  with the browser pass, alongside 2b's KPI drafting UI.
- **The escalation sweep** (§5.5 rungs) — that is 2c, with `ComplianceEvent` already modelled and
  its idempotency constraint already proven above (invariant 13).
