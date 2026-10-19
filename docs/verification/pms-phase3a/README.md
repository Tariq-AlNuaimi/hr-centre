# Verification — PMS Phase 3a (§6 mid-year change requests, §6.3 version history)

Date: 2026-08-25 · Contract: `docs/blueprints/performance-management-system.md` (Phase 3 section)
· Spec: §2, §4.1, §4.2, §5.1, §5.3, §5.4, §6.1, §6.2, §6.3, §7.1, §8.3

Everything below was **executed**. Where a claim rests on a test, the test was also **mutated** to
confirm it can fail — a green assertion that cannot go red is not evidence.

## 1. Automated gates

| Gate                                           | Result                       |
| ---------------------------------------------- | ---------------------------- |
| `npm run ship`                                 | **green**, 22 gates          |
| `tests/contracts/pms-change-request.test.ts`   | 29/29 pass                   |
| `tests/contracts/pms-change-draft.test.ts`     | 10/10 pass                   |
| `tests/integration/pms-change-request.test.ts` | 12/12 pass (real PostgreSQL) |
| axe — 5 screens × light/dark, en + ar          | **0 violations**             |

## 2. The rule the whole phase turns on

§6.2 speaks of changing "a KPI", singular. §5.3 requires the set to total **exactly 100**, and
unlike goal-setting, **mid-year has no sign-off to catch a violation**. So a request that moved one
weightage would leave an HR-approved baseline sitting at 90% for months, with nothing downstream
noticing until Phase 5 tried to score it.

A request therefore carries **several edits and is approved or rejected as one unit**, and approval
is refused unless the resulting set totals exactly 100. This is enforced in four places, because
each one alone is bypassable by the others:

| Layer             | What it enforces                                                            |
| ----------------- | --------------------------------------------------------------------------- |
| the composer      | live running total; submit disabled off 100                                 |
| `POST` (submit)   | 409 with the arithmetic, so a manager learns while writing, not days later  |
| `POST .../decide` | re-checked against the set **as it stands now** — it can move in between    |
| database CHECKs   | weightage range, non-blank rationale, decision completeness, non-empty edit |

## 3. Migration — applied from an empty database, in order

`prisma migrate deploy` against an empty PostgreSQL 16 database applied **all migrations including
Phase 3a**, then `prisma/seed.ts` produced the 36-person fixture. Verified afterwards:

| Object                                             | Present                                  |
| -------------------------------------------------- | ---------------------------------------- |
| `sign_offs_participant_id_stage_kind_party_key`    | ✅                                       |
| `sign_offs_participant_id_party_key` (the old key) | dropped ✅                               |
| `kpi_change_requests_one_pending_per_participant`  | ✅ (partial, `WHERE status = 'PENDING'`) |

### `SignOff` gained `stageKind`, and every reader was narrowed with it

The old key `[participantId, party]` said a participant signs **once ever**. §7.1 needs a second
pair at year-end on the same participant, which would have collided with the goal-setting pair and
come back as "already signed" — §5.1's flow silently swallowing §7.1's.

Adding the column is only half of it. Four existing readers selected `signOffs` unfiltered, so once
Phase 3b writes `YEAR_END` rows they would have counted a year-end signature as agreement to the
**KPI baseline** — reporting a participant as signed before anyone had looked at their goals, and
silencing a genuine goal-setting miss in the §5.5 ladder. All four now filter on `GOAL_SETTING`
(`lib/pms/signoff.ts` carries the note; the drafting page, the roster route and the cycle sweep
point at it).

## 4. Route-level behaviour — real handlers, real wire payloads, real PostgreSQL

`tests/integration/pms-change-request.test.ts` drives the actual route modules.

| #   | Attempt                                           | Expected                                               | Result |
| --- | ------------------------------------------------- | ------------------------------------------------------ | ------ |
| 1   | Stranger raises a request                         | 404, not 403 (§4.2)                                    | ✅     |
| 2   | Manager moves 40 → 30 alone                       | 409, names 90% and the 10% gap                         | ✅     |
| 3   | …and writes nothing                               | 0 rows                                                 | ✅     |
| 4   | An edit whose every value already matches         | 400 — noise in §6.3's history                          | ✅     |
| 5   | Balanced two-KPI rebalance                        | 201, PENDING                                           | ✅     |
| 6   | …the live baseline while PENDING                  | **unchanged** (§5.1)                                   | ✅     |
| 7   | A second pending request for the same participant | 409 — the partial unique index                         | ✅     |
| 8   | The requesting manager approves their own request | 403 (§6.2)                                             | ✅     |
| 9   | Rejection with no reason                          | 400 (§6.2 mandatory reason)                            | ✅     |
| 10  | HR approves                                       | edits applied, set still 100                           | ✅     |
| 11  | …and the superseded state is archived             | 1 snapshot per edited KPI, `supersededByRequestId` set | ✅     |
| 12  | Deciding an already-decided request               | 409                                                    | ✅     |
| 13  | A second approval on the same KPI                 | `versionNo` 1 → 2, appended                            | ✅     |
| 14  | Withdrawal                                        | status WITHDRAWN, **row and edits survive** (§6.3)     | ✅     |
| 15  | …then a fresh request                             | 201 — the slot is freed                                | ✅     |
| 16  | Listing as someone outside the chain              | nothing about this participant                         | ✅     |
| 17  | Listing as the participant themselves             | only their own                                         | ✅     |

### Mutation tests — the three load-bearing assertions can fail

| Mutation                                                        | Expected to break | Result      |
| --------------------------------------------------------------- | ----------------- | ----------- |
| `DROP INDEX kpi_change_requests_one_pending_per_participant`    | case 7            | ✅ 1 failed |
| Archive the **post**-change state instead of the superseded one | case 11           | ✅ 1 failed |
| Record every field regardless of whether it moved               | 3 draft cases     | ✅ 3 failed |

## 5. Browser pass — production build, 1440×900

`next dev` never completes hydration in this container (the HMR websocket cannot cross the egress
proxy), which leaves the hydration-gated sign-in button permanently disabled. Everything below ran
against `next build` + `next start`, restarted after every rebuild.

Full flow, driven through the UI as a real line manager and a real HR Super Admin:

1. manager opens a report with an HR-approved baseline → composer offered
2. moves Delivery 30 → 20 → badge turns warning, **"Proposed total: 90%"**, submit **disabled**
3. rebalances Quality 45 → 55 → **100%**, submit enabled, "2 KPI(s) changed"
4. submits → composer replaced by the review panel; manager sees **Withdraw**, not Approve/Reject
5. HR opens the same page → **Approve enabled, Reject disabled** until a reason is typed
6. HR approves → live set becomes 20 / 55 / 25 = 100, archive gains Delivery v3 and Quality v2
7. HR raises and **rejects** another → live KPI **unchanged**, reason shown to the manager

Audit trail after the run (`audit_logs`, `entityType = 'KpiChangeRequest'`):

```
UPDATE  REJECTED   verify-hr@example.test
CREATE  PENDING    verify-hr@example.test
UPDATE  APPROVED   verify-hr@example.test
CREATE  PENDING    verify-mgr@example.test
```

Each decision is a conditional `updateMany` — the `status: "PENDING"` predicate is the concurrency
arbiter, and `update` cannot carry it — so `no-unaudited-bulk-write` is satisfied by an explicit
`recordAudit()` beside each one, **inside** the transaction on the approval path so a rollback takes
the audit row with it.

### 5a. Four defects the browser pass caught — all fixed

None of these would have failed a contract test; all four were visible the moment a person looked.

1. **The mid-year banner reported the GOAL-SETTING window.** The roster endpoint returns the
   goal-setting stage — it is the goal-setting roster — and feeding it into this banner told a
   manager the mid-year window was unconfigured while it was open. The banner now reads the
   `MID_YEAR` stage off the cycle.
2. **Every roster row answered a goal-setting question.** Reusing `ParticipantList` put
   "Ready to sign" and "This cycle has no goal-setting stage configured yet (§2)" on a mid-year
   screen — confident answers to a question nobody asked. Replaced with `MidYearRoster`, which
   shows what §6 needs: is there an approved baseline (§5.1), and what does the set weigh (§5.3).
3. **"Participant not found" shown on a page the reader was looking at.** `submitBlockedReason`'s
   404 is the API's existence oracle (§4.2); rendered verbatim it was simply false. It is what an
   employee saw on their **own** mid-year screen, because §6.2 gives the request to their manager.
   The page now translates a 404 into a sentence about who raises a request.
4. **A change request recorded six fields nobody touched.** The composer prefills every field so
   the whole KPI is editable, and sent them all back — so §6.3's permanent history claimed seven
   changes and HR's diff read "Delivery objective for 2099 → Delivery objective for 2099". Only
   moved fields now travel (`minimalEdit`), pinned by `tests/contracts/pms-change-draft.test.ts`
   and mutation-tested.

### 5b. A fifth defect, in the verification itself

The first axe run reported "0 violations, dark" and one contrast failure in light — on **the login
page**. The harness signed in against `localhost` while `AUTH_URL` names `127.0.0.1`, so Auth.js
rejected the cookie and every navigation bounced back to `/login`; the wait predicate
`/\/en(\/|$)/` then matched `/en/login` itself and resolved instantly. The screenshots were of the
login screen. The harness now asserts it is not on `/login` before measuring anything, and waits
for a URL that does not contain `login`. **The numbers in §1 are from the corrected run.**

## 6. Screens

| File                                                               | What                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| `01-mid-year(-dark).png`                                           | the workspace: stage, queue, roster                     |
| `02-participant(-dark).png`                                        | composer, decided history with diffs, §6.3 archive      |
| `03-participant-ar(-dark).png`                                     | the same screen in Arabic / RTL                         |
| `90-goal-setting-phase2(-dark).png`, `91-people-phase1(-dark).png` | Phase 1 and 2 screens, re-audited to show no regression |

## 7. Left open, deliberately

- **§6 never says whether an approved mid-year change needs re-signing.** **ANSWERED 2026-10-19 by UAT Scenario C (ADR-072) — the employee acknowledges before HR decides.** At the time the operator chose to
  surface the divergence rather than invent a re-sign step: `SignOff.kpiSetHash` already records
  what each party agreed to, so an approved change makes the goal-setting signatures visibly stale
  without blocking anything. **Flag to Rihal.**
- **ADR-067 step 3 stays blocked.** Nothing here drops, truncates or stops populating
  `employees.basic_salary`.
- Phase 3b (§7 year-end self-assessment → manager review → both sign) rides the `stageKind`
  discriminator this phase added, and is the next increment.
