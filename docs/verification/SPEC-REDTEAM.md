# Red-team: the specification vs. the running app

**Date:** 2026-08-25 · **Spec:** `PMS_Functional_Specification_v1.0.docx` (the operator re-supplied
it for this pass; its text is byte-identical to the in-repo copy, so the target has not moved).

**Why this exists.** `SPEC-CONFORMANCE.md` said "§1–§14 and Appendix A are built" and marked every
clause ✅. The operator did not believe it. They were right not to.

## The headline

**The conformance report's claim is true as written and misleading as read.**

It measured one thing: does an implementation exist, with a clause-named test. By that measure it is
accurate — the routes exist, the domain logic is correct, the tests are real and they fail when the
implementation is removed. I re-verified the hard arithmetic myself and it holds (§8.3's weight
table, §8.7's band boundaries, §11.3's coefficients, §11.4's pro-ration, §3.4's import validation,
§4.5's salary confidentiality, §13.5's Super-Admin-only master export).

But "built" was allowed to stand in for "a person can do this", and those are not the same claim.
**Eleven write endpoints have no caller anywhere in the user interface.** The logic behind them is
complete, tested, and unreachable. A test that imports a route module and calls it supplies its own
caller, so no test in this repo can observe that nobody else does.

The sharpest consequence, stated plainly:

> **No employee can fill in a 360 assessment. There is no form.** `POST /api/three-sixty/responses`
> — incremental save, IN_PROGRESS tracking, duplicate-submission prevention, rater-only authority,
> all built and tested — is called by nothing. §9 is the largest single piece of the specification,
> and its actual users cannot use it.

And because §8.3 gives every non-C-Level track a 360 weight, `scoreEmployee` refuses to score anyone
without a 360 result. So the unreachable form is not an isolated gap in §9 — **it blocks §8, §10,
§11 and §13 for every non-C-Level employee in the company.**

## How this was missed, including by me

Three filters in a row, each of which passes the same blind spot through:

1. **Contract and integration tests call route modules directly.** Reachability is invisible to a
   test that supplies its own caller.
2. **The browser pass I ran on 2026-08-25** found the same class of defect (§8's score run had no
   trigger) and fixed that one instance — but I then built `prisma/seed-demo-cycle.ts` to populate a
   cycle, and **the fixture wrote the 360 cycle, its templates, its responses, and the calibration
   target straight into the database.** Every gap listed below was papered over by my own fixture.
   The screens looked populated because I populated them behind the product's back.
3. **The conformance report was written by the session that wrote the code**, from the same
   understanding that produced it. It could only re-assert what that session already believed.

The fixture is still worth having — without it the screens have no content at all — but it must be
read as a _demo_ fixture, never as evidence that a flow works.

## Findings

Severity is about what a real HR team hits on day one, not about code quality.

### F1 — CRITICAL · §9.7 · No 360 assessment form exists

`POST /api/three-sixty/responses` has no UI caller. No component references
`AssignmentResponse`, `three-sixty/responses`, or any answering form. A rater who is assigned a 360
has nowhere to answer it.

Blocks: §9.5 (no ratios), §8.5 (no 1–5 equivalent), §8.6 (no final score for any non-C-Level
track), §10.7 (calibration never opens), §13.2 (nothing to publish), §11 (no bonus).

### F2 — CRITICAL · §10.2 / §10.3 · The target distribution cannot be set

`PUT /api/calibration` — which writes the five band percentages and the editable ≥5 department
threshold — has no UI caller. The calibration screen reads the target and renders the gap against
it, but offers no way to define it. §10.2 makes it "editable" and assigns it to the HR Super Admin;
§10.7's readiness check refuses calibration without one. So the gate is shut with no key.

My fixture wrote the target row directly, which is why the calibration screen looked complete.

### F3 — HIGH · §9.1 / §9.2 · A 360 cycle and its templates cannot be created

`POST /api/three-sixty` (which creates the cycle _and_ its three §9.2 templates in one act) has no
UI caller. The 360 screen can only read a cycle, regenerate assignments, and activate. There is also
no question-authoring surface anywhere — §9.2 requires three templates of scored plus open-ended
questions, and nothing in the product can write one.

### F4 — HIGH · §12.1 / §12.3 · Leavers and transfers cannot be recorded manually

`POST /api/leavers` and `POST /api/transfers` have no UI callers — `/admin/edge-cases` only GETs
both. §12.1 is explicit that leaver status is "settable by import **or manually** (immediate one-off
resignations)". The manual half does not exist. §12.3's transfer — the whole split-year mechanism —
can only be created by writing to the database.

### F5 — MEDIUM · §9.6 · HR cannot edit an individual's raters, and projects are unreachable

`POST /api/three-sixty/assignments` (set one ratee's raters) has no UI caller; only the bulk
regenerate (`PUT`) does. §9.6 says "HR reviews and **edits** assignments before launch" — HR can
regenerate wholesale or accept what the mapping produced, nothing in between.

`GET`/`POST /api/projects` (§9.6's optional project-based peer sourcing) have no UI caller at all.

### F6 — MEDIUM · §9.8 · Individual 360 reports cannot be viewed — **FIXED**

`GET /api/three-sixty/results` — the consolidated per-employee 360 report, HR and executive only —
has no UI caller. §9.8 asks for "individual 360 reports"; the data is assembled and unreachable.

**Fixed 2026-08-26** — `components/pms/ThreeSixtyResultCard.tsx`, on the individual record where
§13.6 already sends HR and the executive viewers for drill-down, and deliberately NOT on the 360
console, where it would sit beside §9.4's assignment map and defeat §13.1's anonymity. Comments are
consolidated by question rather than listed flat, for the same reason. Verified end to end (a draft
window carried through activation to three submitted forms and a computed report):
`docs/verification/pms-360-report/README.md`.

### F7 — MEDIUM · §4.4 · "My Tasks" omits 360 assignments

§4.4 is explicit that My Tasks carries "any 360 assigned to me (report, peer, or colleague)", and
that the space is "driven by assignment, not hierarchy". `lib/pms/tasks.ts` produces exactly two
task kinds: your own KPI set, and drafting for your reports. A 360 assignment never appears — which
is consistent with F1, since there would be nowhere for the task to link to.

### F8 — MEDIUM · §9.5 · A 360 averaged over fewer than three raters is silent

§9.5 says "average the **3** ratios". `overallRatio` averages over however many arrived, which is a
deliberate and defensible choice (documented in `lib/pms/three-sixty.ts`: dividing by a hard 3 would
penalise a ratee for a rater's departure). But **nothing downstream records how many raters actually
contributed.** `EmployeeScore` stores only `threeSixtyScore`, so a score built from one rater is
indistinguishable from one built from three — on the employee's scorecard, in the master export, and
in the bonus that follows from it. In the 36-person demo fixture, 26 of 33 ratees had fewer than
three raters available.

**Partly fixed 2026-08-26** — the count is now stated beside the figure on §9.8's individual report,
with an explicit caution below three (`ThreeSixtyResultCard`). The `EmployeeScore` column that would
carry it into the scorecard, the §13.5 export and the §11 bonus is still absent; that needs a
migration, which is Ask-before, so it remains open in the register.

### F10 — MEDIUM · §9.1 · The 360 window is write-once and cannot be corrected — **FIXED**

Found on 2026-08-26 while verifying F6, by trying to use the product rather than reading it.
`POST /api/three-sixty` was the only writer of `opensAt`/`deadline`; there was no `PATCH`, no
`DELETE`, and §9.1 allows exactly one 360 per performance year. A cycle created with a mistyped date
was therefore wrong for the whole year with no path back — and §5.4 makes a deadline a hard lock,
which is exactly why the typo has to be correctable before anyone is standing behind it. This is the
same species as F1–F6 (a state the product can enter and not leave), and it was invisible to every
test because a test supplies its own dates.

**Fixed** — `PATCH /api/three-sixty` (HR-only, DRAFT-only, dates only) and
`components/pms/ThreeSixtyWindow.tsx` on the 360 console. It disappears at activation: once §9.7 has
put the window in every rater's task list, moving a deadline under someone mid-form is a different
act, and not one §9 asks for.

### F9 — LOW (operational) · §5.5 / §9.7 · No reminder or invitation is ever sent

The escalation ladder and its notifications are implemented and wired to the daily cycle sweep, but
`lib/email.ts` no-ops unless `SMTP_HOST` is set, and `.env.example` does not carry one. Unless SMTP
is configured on the deployment, §5.5's "escalating reminders", the skip-level and HR escalation
mails, and §9.7's "automated invitations" and "automated reminders before deadline" all silently do
nothing. The compliance _record_ is still written, so this degrades to "the log is right, nobody was
told".

## What is genuinely solid

Stated because a red-team report that only lists faults is as misleading as the one it corrects.
Each of these I checked against the clause myself, in the code, this session:

- **§8.3's weight table** — Director 30/40/10/20, Manager 20/50/10/20, Lead 10/60/10/20, Individual
  10/—/80/10. Exact. Individuals carry `departmental: null`, not `0`, so a mis-keyed departmental
  score is refused rather than silently multiplied away.
- **§8.7's band boundaries** — 4.50 / 4.00 / 3.00 / 2.00, in `Decimal`, with a written rationale for
  why floating point would put a 4.50 into the wrong band and the wrong bonus coefficient.
- **§8.3's C-Level path** — no formula, entity score passed straight through, exempt from
  goal-setting, self-assessment and 360.
- **§11** — the six-month effective-service gate net of unpaid leave, the §11.3 coefficients, the
  ÷365 pro-ration, and the spec's own worked example (7 months employed − 2 unpaid = 5 effective =
  not eligible) all pinned by tests.
- **§3.4's import validation** — all six required rules, plus C-Level department/entity XOR,
  self-manager, manager cycles, duplicate IDs and emails. Genuinely thorough.
- **§3.5 / Appendix A** — absence from an import file changes nothing.
- **§4.5 / §11.6** — salary and bonus gated to HR and the executive viewers, enforced at the query
  layer rather than in the UI, so a line manager cannot reach it even through the chain view.
- **§13.5** — the master export is HR Super Admin only; HRBP is excluded, as the clause requires.
- **§13.2** — publish is all-at-once, guarded by a typed confirmation, reversible, and the
  un-publish reason is **mandatory** in the zod schema (§14's design mandate). I expected this one
  to be optional and it was not.
- **§5.4's hard locks** — enforced in the domain seams (`kpi.ts`, `rating.ts`, `year-end.ts`,
  `change-request.ts`, `signoff.ts`), not merely modelled.
- **§10.1** — raw scores are written once and never updated; calibration writes only the calibrated
  band, through an audited adjustment row carrying a mandatory reason.

## What "coverage" should mean from here

The conformance report should not claim a clause is met until the flow it describes can be completed
by the role the clause names, in a browser, without a database write. Two measures, kept apart:

| Measure                                                       | Status                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Clause has a correct implementation and a clause-named test   | **§1–§14 + Appendix A** — accurate                                          |
| Clause's flow is completable by its named role through the UI | **§9 blocked; §10, §11, §13 blocked behind it; §12's manual paths missing** |

The second row is the one a stakeholder means by "done", and it is the row nobody was tracking.
