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

## 7. Phase 2b / 2c / screens — built as three parallel units

Three write-disjoint units ran concurrently against a shared seam (`lib/pms/kpi.ts`,
`lib/validations/kpi.ts`) written first so §5.3's exactly-100% rule has ONE implementation that
the drafting UI, the sign-off route and HR's approval all consume.

| Unit               | Owned                                                                 | Tests |
| ------------------ | --------------------------------------------------------------------- | ----- |
| KPI drafting       | `app/api/kpis/**`, participants roster                                | 26    |
| Sign-offs + ladder | `lib/pms/signoff.ts`, `compliance.ts`, sign-off/approve/sweep routes  | 24    |
| Screens            | `admin/cycles`, `admin/roles`, `components/pms/Cycle*`, sidebar, i18n | —     |

**135 contract tests pass** across the phase. Full `npm run ship` green with all three integrated.

### 7a. Four defects the parallel units surfaced — all fixed

1. **`updateKpiSchema` reset KPI order on every partial edit.** `z.object({...}).partial()` does
   NOT strip a `.default()`, so `safeParse({})` succeeded with `{ orderIndex: 0 }`. A manager
   rewording a KPI would have silently moved it to the top of their list, and the "Nothing to
   update" guard could never fire. Rebuilt the update schema from an undefaulted field shape;
   create keeps its default. Pinned in `pms-weightage.test.ts` and `pms-kpi.test.ts`.
2. **`GET /api/employees` never returned `pmsRoles`.** The column was selected in Prisma since
   Phase 1 but dropped by `serializeEmployee`, so the HR-roles screen could not display the roles
   it was editing — every row would have read "Unknown". Carried through now, for every actor:
   §4.5's field-level restriction names salary and bonus specifically, and §5.5's escalation
   ladder depends on people being able to tell who HR is. Visible working in `02-roles.png`.
3. **The `admin` breadcrumb linked to a page that does not exist.** `/admin/import`,
   `/admin/org-setup`, `/admin/cycles` and `/admin/roles` all exist; `/admin` does not. Every one
   of those screens rendered a clickable "Admin" crumb pointing at a 404, and Next prefetched it
   on render — so the 404 fired whether or not anyone clicked. **Predates Phase 2** and affected
   the Phase 1 admin screens identically. Grouping segments now render as plain text. Verified:
   all three admin routes report zero failing requests where they previously reported one each.
4. **Duplicated KPI select and serialiser across two route files.** A Next route module may only
   export HTTP verbs, so the two KPI routes could not share helpers; extracted to
   `lib/pms/kpi-select.ts` beside `employee-select.ts`.

### 7b. Screens — looked at, not assumed

Captured at 1440×900, light and dark, authenticated as HR Super Admin.

| Screen          | axe (light)                | axe (dark)                 |
| --------------- | -------------------------- | -------------------------- |
| `/admin/cycles` | 0 violations, 0 unresolved | 0 violations, 0 unresolved |
| `/admin/roles`  | 0 violations, 1 unresolved | 0 violations, 1 unresolved |

The unresolved item is `color-contrast` on **row 10 only**, reported as "background could not be
determined because it's partially obscured by another element" — the sticky-header overlap
artifact. The identical elements in the other nineteen rows scored clean, which is what makes it
an artifact rather than a finding.

`01-cycles.png` shows the three touchpoints with **opens and locks times**, not just dates — §5.4
makes a deadline a hard lock, so the time is the fact. A CLOSED cycle offers "no further changes"
rather than controls that would 409.

`02-roles.png` shows the additive roles rendering as badges (§4.3), and is the proof that defect
2 above is fixed.

## 8. The §5.5 escalation sweep, against a real database

The ladder had 24 unit tests and had never met a database. Run against PostgreSQL 16 with the
seeded 37-person fixture, a cycle whose GOAL_SETTING deadline sits **10 days in the past**, and
four participants hand-placed into the four states §5.5 distinguishes.

| Who  | State                            | Events written                                              | `managerEmployeeId` | Detail                                                         |
| ---- | -------------------------------- | ----------------------------------------------------------- | ------------------- | -------------------------------------------------------------- |
| 1100 | manager never drafted            | `DEADLINE_MISSED` + `ESCALATED_SKIP_LEVEL` + `ESCALATED_HR` | 1001                | "Manager did not draft KPIs before the goal-setting deadline." |
| 1101 | employee signed, manager did not | all three                                                   | 1100                | exactly `employee signed, manager did not`                     |
| 1102 | manager signed, employee did not | **`DEADLINE_MISSED` only**                                  | **NULL**            | exactly `Employee did not sign`                                |
| 1110 | both signed                      | **none**                                                    | —                   | nobody was non-compliant                                       |

1102 is the row that matters most. §5.4 puts an unsigned employee's responsibility on the
employee, so it must not appear in the manager's compliance record — and it does not: the event
carries a null manager and never reaches rungs two or three.

`missedByHours` reads **240** on every one, which is the 10 days, floored (§5.6's "by how long").

### Idempotency, proven rather than argued

| Run | `eventsWritten` | `duplicatesSkipped` | Totals after                 |
| --- | --------------- | ------------------- | ---------------------------- |
| 1st | 32 / 30 / 31    | 0                   | 32 / 30 / 31                 |
| 2nd | **{}**          | **93**              | **32 / 30 / 31** — unchanged |

A retry, or a manual invocation on the same day, cannot inflate a manager's miss count. That
matters because §11.2 reads this table as an objective accountability report.

### Cron authorisation

| Request                         | Expected | Got    |
| ------------------------------- | -------- | ------ |
| `POST` with no token            | 401      | 401 ✅ |
| `GET` with a wrong bearer token | 401      | 401 ✅ |

## 9. The two Ask-before changes, with the operator's approval

### 9a. An admin password reset was audited as an indistinguishable blank — FIXED

Recorded earlier as `UPDATE | User | changes: null`. The cause was not the scrub, which already
redacts values while keeping keys. **`computeChanges` iterates the keys of `after`, and `after` is
whatever the CALLER selected.** `PUT /api/users/[id]` returns six columns, none of them
`passwordHash`, so the changed column was never present to be compared.

This is a general defect, not a PMS one: any audited update with a narrow `select` under-reports
what changed.

The audit extension now re-reads the full row before diffing (`before` was already fetched
unselected, so this makes the pair symmetric). Verified against PostgreSQL:

```
audit #1  {"passwordHash":{"from":"[redacted]","to":"[redacted]"},"passwordChangedAt":{...}}
audit #2  {"name":{"from":"Admin","to":"Renamed Person"}}
```

The hash is still never stored — only the _fact_ of the change, which is now queryable and
distinguishable from a rename. That is what makes ADR-065's compensating control real: that ADR
accepts a platform admin can reach HR Super Admin access and names the audit trail as the control,
so the trail has to be able to show the action that grants it.

A null re-read means the update soft-deleted the row and the extension filtered it; the caller's
projection is kept and behaviour is exactly what it was. Cost: one indexed lookup per audited
update.

### 9b. `Kpi` registered in `SOFT_DELETE_MODELS` — FIXED

Two Phase 2 units hit this independently. Verified after registration:

| Path                              | Row survives | Soft-deleted | Audit action  |
| --------------------------------- | ------------ | ------------ | ------------- |
| `prisma.kpi.delete()`             | yes ✅       | yes ✅       | **DELETE** ✅ |
| hand-rolled `update({deletedAt})` | yes ✅       | yes ✅       | UPDATE ⚠️     |

Normal reads return **0 of 2** withdrawn KPIs. The route's DELETE now uses `delete()`, which is
the difference between an audit trail that says a KPI was withdrawn and one that says it was
edited — the extension infers a soft delete by comparing `deletedAt` across before/after, and this
route's narrow select hides it.

**Registration is not the whole fix, and the code does not pretend it is.** That extension filters
the TOP-LEVEL `where` only — its own documented and test-asserted limitation — and the KPI read
that decides §5.3's total pulls `participant.kpis` through a nested select, which it cannot reach.
Every KPI read keeps its explicit `deletedAt: null` for that reason.

## 10. Manager drafting + the §4.4 home split

Built as a fourth parallel unit. Two gaps it flagged but could not close from its own files were
closed here.

### 10a. The guard chain had two implementations — now one

The drafting page is an RSC reading through Prisma (the template's blessed pattern), so it could
not go through `POST /api/kpis`. It therefore restated the whole refusal chain — §4.2 → §8.3 →
§2 → §5.4/§5.1 — in the same order, with **two of the sentences copied as string literals**. Two
copies of a security ordering drift; two copies of a sentence drift faster.

`kpiSetAccessRefusal` in `lib/pms/kpi.ts` is now the single implementation, and both callers use
it. `visible` is passed IN rather than recomputed, because the route resolves it from a
descendant set and the page already has one — both correct, and neither belongs inside the shared
function. `POST /api/kpis` dropped from 194 to 137 lines in the process.

### 10b. "My Tasks" was a sample presented as a list — now exact

§4.4 is explicit that the personal action space is _"driven by assignment, not hierarchy or role
name"_. There was no assignment filter, so the home screen assembled its task list from **page 1
of the whole roster plus a name search** for the viewer's own row. That is exact at 37 people and
silently wrong at 500: the viewer's own row falls off page 2 and their task list quietly loses
entries — the worst failure mode a task list has, because nothing looks broken.

`scope=mine` on the participants route is that filter, server-side. Verified on live payloads:

| Actor            | no scope        | `scope=mine`                    |
| ---------------- | --------------- | ------------------------------- |
| HR Super Admin   | 37              | **1** (own set only)            |
| Line manager     | 8 (whole chain) | **3** (self + 2 direct reports) |
| Individual       | 3               | 3 — it NARROWS, it never widens |
| `scope=everyone` | —               | **400**                         |

The home screen is one request now, and the count it shows is the truth rather than a sample.

### 10c. Screens

| Screen                      | axe (light)                | axe (dark)                 |
| --------------------------- | -------------------------- | -------------------------- |
| Home — My Tasks / Oversight | 0 violations, 0 unresolved | 0 violations, 0 unresolved |
| Goal-setting roster         | 0 violations, 0 unresolved | 0 violations, 0 unresolved |

No failing requests, no page errors. `03-home.png` shows a line manager's view (Layla Al-Habsi,
1202): **My tasks** with exactly the three `scope=mine` items — her own set plus her two direct
reports — each carrying the stage's lock time; **Oversight** scoped to her chain, badged "Line
manager"; and a sidebar with no admin entries, because the capability gates are doing their job.
The three rows are in the order §4.4 needs them (see §11c).

## 11. The drafting and sign-off screen — looked at, not assumed

Captured at 1440×1000, light and dark, against PostgreSQL 16 with a **production build**
(`next build` + `next start`), authenticated as HR Super Admin. Three participant states, so the
§5.3 rule is on the record in both directions.

| Capture                   | State                                                | axe (light + dark)         |
| ------------------------- | ---------------------------------------------------- | -------------------------- |
| `05-drafting`             | 3 KPIs at exactly 100%; employee signed, manager not | 0 violations, 0 unresolved |
| `06-drafting-both-signed` | both parties signed                                  | 0 violations, 0 unresolved |
| `07-drafting-incomplete`  | 2 KPIs at 75% — sign-off refused, gap named          | 0 violations, 0 unresolved |
| `08-people`               | directory (breadcrumb regression check)              | 0 violations, 0 unresolved |
| `09-people-no-results`    | filtered to nothing (`common.noResults`)             | 0 violations, 0 unresolved |

Zero console errors and zero page errors on all ten renders.

`07-drafting-incomplete.png` is the one that carries §5.3: the strip reads **75%**, the amber note
says "A draft may sit at any total while you work. 100% is what sign-off needs.", the sentence
below it says "Weightages total 75% — 25% short of the 100% required to sign off (§5.3)", and the
sign control is disabled. §5.3 gates signing, not drafting, and the screen says exactly that.

Every capture carries the standing note: _"There is no reject button. A party who does not agree
simply does not sign, and the conversation happens away from this screen."_ No reject control
exists anywhere on the screen.

### 11a. Three defects the browser pass surfaced — all fixed

Each one passed `tsc`, ESLint, the production build, and axe. None of them was findable without
rendering the page.

1. **`buttonVariants()` called from a server component.** Splitting `KpiDraftBoard` for the
   complexity budget left `buttonVariants` exported from a `"use client"` module and imported by
   an RSC — the page threw at request time. Extracted to `components/ui/button-variants.ts`
   outside the client boundary, re-exported from `button.tsx` so no call site moved.

2. **The sign-off panel rendered raw translation keys.** `SignOffPanel.tsx` and `KpiList.tsx` were
   both written against `useTranslations("pms.goalSetting")`; the keys live under `pms.kpi`. The
   screen came up showing `pms.goalSetting.signOffTitle` where the heading belongs. next-intl's
   fallback for a missing key is to print the key, so this type-checks, lints, builds, renders and
   passes axe — a screenshot was the only thing that could catch it.

   Fixed, and then **closed as a class**: `tests/contracts/i18n-keys.test.ts` resolves every
   `t("…")` call in `components/**` and `app/**` against both locale bundles. It found a third
   instance immediately — `common.noResults`, asked for by the people directory **since Phase 1**
   and never defined, so filtering the list to nothing showed the raw key to an HR user. Defined
   in `en` and `ar`; `09-people-no-results.png` is the proof.

3. **Breadcrumbs printed raw cuids.** `/people/<id>` rendered its own crumb as
   `Cmt7n76cx00008z7dyiua00cc`, and the drafting page carried the same noise mid-trail. Nothing in
   the app sets a dynamic label, so an unlabelled opaque id is dropped from the trail rather than
   printed; a labelled one still renders, so the filter disappears the moment a page supplies a
   name. Verified in the captures: `Home / Goal Setting / Participants` and `Home / People`.

### 11c. The task list led with the one card nobody could act on

Found reviewing `lib/pms/tasks.ts` before the push, not in the browser. Within a stage band the
rank was `own-signable = 2`, `own-waiting = 0`, `report-not-drafted = 0` — so "your manager has
not finished drafting your KPIs yet", which is context rather than a task, tied for first and won
the alphabetical tie-break against the report rows. A list read and acted on top-down opened with
the row you cannot act on and buried "Review and sign" at the bottom.

Ranks are now named (`KIND_RANK`) and ordered by how much of someone else's work each card holds
up: an undrafted report first (it blocks that person entirely), then a part-drafted one, then a
set awaiting my signature, then my own signable set, and the informational card last.
`03-home.png` is that order — Omar (nothing drafted) → Zainab (60%, cannot be signed) → my own set
("Review and sign").

The module's header says it lives in `lib/` because this is "exactly the logic a test can check
and a screenshot cannot" — and it had no test. `tests/contracts/pms-tasks.test.ts` is that test:
17 cases pinning the ordering, §4.4's assignment-only rule, §8.3's exemption, §5.1's "a signed
step is not a task", the verbatim carry of the server's refusal sentence, and the due-soon band's
boundary. The ordering assertions fail against the old ranks.

### 11b. Gotcha worth keeping

**Hydration never completes in `next dev` in this container**, because the HMR websocket cannot
handshake through the proxy — so any control gated on `useHydrated()` (the login submit button,
by design, to keep credentials out of the query string) stays permanently disabled and the
browser pass cannot even log in. The production build has no such gate. **Browser verification in
this environment must run against `next build` + `next start`, not `next dev`.**

## 12. Still not verified

- **§12.3's mid-cycle transfer split** — the 360 component's day-weighting question is open and
  belongs to Phase 6, which introduces `EmployeeAssignmentPeriod`.
- **Arabic / RTL rendering of the Phase 2 screens** — and it is a config decision, not a gap.
  `project.config.json` sets `locales: ["en"]`, so `/ar/*` 307s to `/en/*` and there is no RTL
  layout to photograph. `messages/ar.json` is still maintained and the i18n key test now holds
  **every bundle in `messages/`** to full parity, so turning Arabic on is a one-line config flip
  rather than a translation project. The RTL browser pass belongs to the session that flips it.
- **ADR-067 (salary at rest)** awaits the operator's decision and is marked blocking on the first
  real import.
