# Verification — §9.7's 360 answering form (red-team F1)

Date: 2026-08-25 · Spec: §9.3, §9.5, §9.7, §4.3, §4.4 · Fixes:
`docs/verification/SPEC-REDTEAM.md` F1 and F7

The red-team pass found that `POST /api/three-sixty/responses` was called by nothing: no screen let a
rater answer a 360. Because §8.3 gives every non-C-Level track a 360 weight and §8's score run
refuses an employee without a 360 result, that one missing form blocked §8, §10, §11 and §13 for
every non-C-Level employee. This is that form, verified by driving it.

## 1. Result

| Check                                                        | Result                         |
| ------------------------------------------------------------ | ------------------------------ |
| Full rater journey driven in a browser                       | **passes** (§3 below)          |
| axe serious/critical (WCAG 2.0/2.1 A + AA), 8 runs           | **0**                          |
| Runs = {en, ar} × {light, dark} × {desktop 1440, mobile 390} | 8                              |
| Contract tests added                                         | 10 (5 answer-gate, 5 My Tasks) |
| Mutation-tested                                              | yes — §4 below                 |
| `npm run ship`                                               | green                          |

`axe-results.json` is committed. The PNG captures are not (`.gitignore` excludes
`docs/verification/**/*.png`), per the precedent set in Phase 3a.

## 2. What was built

- **`GET /api/three-sixty/responses`** — the form itself: the questions this rater was asked, plus
  whatever they have already saved. This read did not exist, which is a large part of why the screen
  did not either: neither endpoint a rater could reach carries a form (`/api/three-sixty` returns
  cycle dates only for a plain employee, and the assignments list gives the template's TYPE, not its
  questions). Rater-only, 404 for anyone else — §4.2's convention, and here it also protects §13.1,
  since an id that answered "yes, that exists" would let someone enumerate who assesses whom.
- **`lib/pms/three-sixty-answer.ts`** — `answerBlockedReason`, the single gate for "may this rater
  answer right now". Both the read and the write stand behind it, so a form that renders is a form
  the route will accept. Previously the POST inlined these four refusals.
- **`components/pms/ThreeSixtyForm.tsx`** — §9.3's forced 4-point scale as a radio group per
  question, **with no pre-selection**: a default would be an opinion the rater never expressed, and
  §9.5 divides by the whole form, so a silently-defaulted answer is indistinguishable from a
  considered one. Save and Submit are separate acts (§9.7's IN_PROGRESS is real), and Submit stays
  disabled with a count of what is left, because the route refuses an incomplete submission.
- **§4.4's missing task category** — `buildThreeSixtyTasks` puts "any 360 assigned to me" into My
  Tasks, which previously produced only two kinds, both from the goal-setting roster.

## 3. The journey, driven end to end

Signed in, then Playwright-driven through the real UI — no direct route calls:

| Step                           | Expected                                  | Result |
| ------------------------------ | ----------------------------------------- | ------ |
| Open Home                      | a 360 task appears in My Tasks (§4.4)     | ✅     |
| Follow it                      | lands on `/three-sixty/assignments/<id>`  | ✅     |
| Before answering               | Submit **disabled** (§9.5's completeness) | ✅     |
| The form                       | 4 scored groups + 1 open-ended (§9.2)     | ✅     |
| Answer all four, add a comment | Submit **enabled**                        | ✅     |
| Save progress, then Submit     | accepted; screen shows submitted          | ✅     |
| Back to Home                   | the task is **gone** (§9.7 one-way)       | ✅     |

## 4. Two defects the driving caught, both fixed

Neither was visible from the code, and both were found by running the journey rather than the route.

### 4a. An HR user who is also a rater saw no task

`GET /api/three-sixty/assignments` branched on `isHr(actor)`: HR got the who-assesses-whom map, and
everyone else got their own assignments. The seeded admin is an HR Super Admin **and** somebody's
peer, so they were sent down the map branch and shown an error instead of their own 360.

§4.3 is explicit that roles are **additive** — "a user may hold more than one; permissions merge" —
and §4.4 says My Tasks is "driven by assignment, not hierarchy or role name". The scope now follows
the **request**: asking without a cycle id is "what am I asked to do" and belongs to everyone;
asking with one is HR's map. This is the exact failure §4.3 exists to prevent, and it would have hit
every HR person at Rihal who is also somebody's peer.

### 4b. A 360 task showed "Deadline passed" while it was due in a month

`TaskRow` rendered one badge for the whole list, derived from the goal-setting stage — a safe
assumption while every task came from that stage. A 360 runs on the 360 cycle's deadline, so the
first capture showed a task due 24 September badged "Deadline passed" because goal-setting had
closed in January. `Task` now optionally carries its own `tone`/`dueAt`; absent, the row falls back
to the stage's, so every pre-existing row renders exactly as before. Pinned by a test.

## 5. Mutation log

| Mutation                                            | Expected to break         | Result      |
| --------------------------------------------------- | ------------------------- | ----------- |
| Stop skipping `SUBMITTED` in `buildThreeSixtyTasks` | "§9.7 … produces no task" | ✅ 1 failed |

## 6. A note on the fixture

`prisma/seed-demo-cycle.ts` closes the 360 and submits every form, which is the right shape for
reviewing §8–§13 but leaves nothing answerable. To exercise this screen the local cycle was set back
to ACTIVE with a future deadline and one assignment reset — a database edit, made deliberately and
recorded here, because the alternative is a fixture that hides the very screen it was built to test.
That is the same trap the red-team report describes: a fixture is a demo, never evidence a flow
works.

## 7. Known limitation, found in review

**A rater cannot delete a comment they already saved.** The form sends only answered questions, and
the route skips a row whose score and text are both null, so clearing an open-ended answer leaves
the previously saved text in place. Adding a scored answer or rewriting the text both work; only
emptying it does not. Deliberately not fixed here — it needs the route to treat an explicit blank as
a delete, which is a change to the write contract rather than to this screen, and F2 is the more
urgent half of the red-team report. Recorded so the next reader does not mistake it for working.

## 8. Still open from the red-team report

F2 (§10.2's target distribution has no editor) is next, and is the other CRITICAL. F3–F6 and F8–F9
remain as registered in `docs/findings-register.md`.
