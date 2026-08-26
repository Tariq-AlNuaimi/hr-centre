# Verification — PMS Phase 3b (§7 year-end assessment)

Date: 2026-08-25 · Contract: `docs/blueprints/performance-management-system.md` (Phase 3 section)
· Spec: §2, §4.2, §5.1, §5.3, §5.4, §7.1, §7.2, §8.1, §8.3

Everything below was **executed**.

## 1. Automated gates

| Gate                                     | Result                  |
| ---------------------------------------- | ----------------------- |
| `npm run ship`                           | **green**, 21 gates     |
| `tests/contracts/pms-rating.test.ts`     | 29/29                   |
| `tests/integration/pms-year-end.test.ts` | 14/14 (real PostgreSQL) |
| axe — 3 screens × light/dark, en + ar    | **0 violations**        |

## 2. §7.1's order is the load-bearing rule

"Employee self-assesses → manager reviews → offline discussion → both sign off on the final
ratings." The order is enforced, not merely rendered: a manager cannot rate a KPI the employee has
not assessed. Without that, "reviews" quietly becomes "rates on their behalf" and the employee's
own view of their year is never recorded at all.

| #   | Attempt                                         | Expected                 | Result |
| --- | ----------------------------------------------- | ------------------------ | ------ |
| 1   | Manager rates a KPI with no self-assessment     | 409, names §7.1          | ✅     |
| 2   | Stranger rates                                  | 404, not 403 (§4.2)      | ✅     |
| 3   | Manager or HR self-assessing "for" the employee | 404                      | ✅     |
| 4   | Level 0, 6 or 3.5                               | 400 (§8.1)               | ✅     |
| 5   | Employee self-assesses                          | 201 + set state          | ✅     |
| 6   | Re-rating the same KPI                          | 200, **one row**         | ✅     |
| 7   | Manager rates differently with no reason        | 409, **nothing written** | ✅     |
| 8   | …with a reason                                  | 201, reason stored       | ✅     |
| 9   | Manager agreeing                                | 201, no reason needed    | ✅     |
| 10  | Signing a half-rated assessment                 | 409, counts what's left  | ✅     |
| 11  | Both parties signing a complete one             | 201 each                 | ✅     |
| 12  | Signing twice                                   | 200, idempotent          | ✅     |
| 13  | HR signing in the line manager's place          | 403 (§7.1, §5.5)         | ✅     |
| 14  | A YEAR_END signature beside a GOAL_SETTING one  | both co-exist            | ✅     |

Case 14 is Phase 3a's `stageKind` work paying off: the same participant and party now carry one
signature per stage, which is precisely what the old `[participantId, party]` key made impossible.

## 3. Database constraints — 6/6 behave correctly

Executed against the live schema:

| Attempt                                  | Expected            | Result                                   |
| ---------------------------------------- | ------------------- | ---------------------------------------- |
| level 0                                  | refused (§8.1)      | `kpi_ratings_level_range_check` ✅       |
| level 6                                  | refused (§8.1)      | `kpi_ratings_level_range_check` ✅       |
| comment of `"   "`                       | refused             | `kpi_ratings_comment_not_blank_check` ✅ |
| a valid rating                           | accepted            | ✅                                       |
| a second EMPLOYEE rating on the same KPI | refused (§7.1)      | `kpi_ratings_kpi_id_party_key` ✅        |
| the MANAGER's rating on that KPI         | accepted, co-exists | ✅                                       |

## 4. Two rules that are NOT in the specification

Both were decided by the operator, are marked as additions everywhere they appear in the code, and
are **mutation-tested** — removing either fails the suite:

| Rule                                                  | Mutation                               | Result       |
| ----------------------------------------------------- | -------------------------------------- | ------------ |
| A divergent manager rating requires a written reason  | make the rule always return null       | 3 tests fail |
| The employee self-assesses before the manager reviews | let the manager rate an unassessed KPI | 1 test fails |

**Flag to Rihal:** §7 settles neither. The first was chosen because an unexplained rating change —
in either direction — is what employees dispute and what §10's calibration cannot interpret months
later. The second is the literal reading of "manager reviews".

A third decision needed no new rule: the manager **sees** the employee's self-assessment while
reviewing. §7.1's word is "reviews", which most naturally means reviewing what was submitted. The
known cost is anchoring; the alternative (blind until both are in) would have invented a step §7
does not describe.

## 5. Browser pass — production build, 1440×900

`next dev` never completes hydration in this container (the HMR websocket cannot cross the egress
proxy), so this ran against `next build` + `next start`.

Confirmed on screen (`02-assessment.png`):

- §7.1 — the five **descriptors the manager authored for that KPI** are the choices, each with its
  level name beneath. Never a bare 1–5 scale: the numbers are §8.1's scoring representation, not
  the question a person is being asked.
- The manager sees the employee's self-assessment, quoted, with when it was recorded.
- The divergence reason is labelled **"Why you rated it differently (required)"** the moment the
  selection differs, with the employee's level named — a rule stated up front rather than
  discovered through a rejected submit.
- Sign-off states both parties explicitly, including **"Not signed yet"** — §5.3's no-reject rule,
  which §7.1 inherits: silence is the signal, so it is stated rather than left as a missing row.
- Each radio carries an accessible name combining the level and the descriptor, so a screen reader
  announces the choice rather than an unlabelled radio in a group of five.

## 6. Screens

| File                          | What                                             |
| ----------------------------- | ------------------------------------------------ |
| `01-year-end(-dark).png`      | the workspace: stage window, year picker, roster |
| `02-assessment(-dark).png`    | the assessment, as the manager reviewing         |
| `03-assessment-ar(-dark).png` | the same screen in Arabic / RTL                  |

## 7. Not in Phase 3b

§8.2's weighted arithmetic and §8.6's final formula (Phase 5 — §6.1 forbids scoring before
year-end and §8 is its own phase), the 360 module (§9), calibration (§10), bonus (§11), and
§12.3's transfer split. Phase 3b **captures** the levels §8 will later score; it computes nothing.
