# Blueprint — editing a 360 cycle after it has been created (§9.4, §9.7)

Scope: app/api/three-sixty/**, lib/pms/three-sixty-edit.ts, lib/validations/three-sixty.ts, components/pms/ThreeSixtyWindow.tsx, components/pms/ThreeSixtyCycleActions.tsx, components/pms/ThreeSixtyRaterEditor.tsx, app/[locale]/(dashboard)/three-sixty/page.tsx

**Status:** approved to build (operator, 2026-10-22 — HR-testing item 3, "items 1 and 3 block my
testing"; the operator asked which parts exist today and which are being added, answered below).
**Builds on:** `docs/blueprints/performance-management-system.md` (§9's surface), and closes a loop
left open by `docs/blueprints/employee-access-and-sso.md`'s §12.1 work — see "The departure
promise" below.

## Problem

A 360 cycle is write-once in every way that matters. Once HR presses activate:

- the **window is frozen**. `PATCH /api/three-sixty` amends `opensAt`/`deadline` only
  `where: { status: "DRAFT" }`, answering 409 "The window is fixed once the cycle is activated
  (§9.7)" otherwise, and `ThreeSixtyWindow` stops rendering at all. A deadline nobody can reach
  cannot be extended, so a cycle that needed another week is simply over.
- **assignments are frozen**. Both writers — the bulk regenerate (`PUT`) and the per-person rater
  set (`POST`) — refuse unless the cycle is a draft, citing §9.6's "before launch". A rater who
  leaves, goes on leave, or was the wrong person cannot be changed.
- **the cycle cannot be ended.** This is the one that blocks testing, and it is half-built in a way
  worth stating precisely: `ThreeSixtyStatus` carries `CLOSED`, and `answerBlockedReason` already
  refuses a rater with "This 360 cycle is closed (§9.8)" — but **no code path in the product ever
  writes `CLOSED`**. The only writers of that column are the create (`DRAFT`), the window amend
  (`DRAFT`-gated) and activate (`DRAFT` → `ACTIVE`). A cycle reaches `ACTIVE` and stays there
  permanently.

### What the spec actually says

- §9.6 — "HR reviews and edits assignments **before launch**." The draft-only rule is a literal
  reading of this sentence, and it is why the build is the way it is.
- §9.4 — "HR **selects and manages** all rater assignments." _Manages_ is ongoing, not
  before-launch-only. This is the clause that authorises an after-launch edit, and the reason this
  blueprint is a reading of §9 rather than a departure from it.
- §9.7 — "Publish/activate the cycle", "automated reminders **before deadline**". The deadline is
  live data the system reads while the cycle runs; nothing in §9 says it is immutable, and nothing
  in §9 provides a close either. The `CLOSED` enum member and its refusal message are the build's
  own anticipation of a clause that does not exist.

### The departure promise

`RecordDepartureDialog` (§12.1) tells HR, before they record a departure, exactly how many of the
leaver's 360 assignments "will need a new rater". For a leaver mid-cycle — the typical case — those
assignments sit in an `ACTIVE` cycle, where no writer will accept a change. The product currently
promises work it then forbids. Part (c) below is what makes that promise true.

## User stories

- **US-1 — HR extends a deadline that is about to pass.** Two raters have not submitted and the
  cycle closes tomorrow. HR moves the deadline out a week; the raters' forms keep working.
- **US-2 — HR ends a cycle.** The responses that matter are in, the stragglers will not submit, and
  §9.8's results should stand. HR closes the cycle, is told what that does, and the cycle stops
  accepting responses.
- **US-3 — HR takes a cycle back to draft.** It was launched by mistake, or against the wrong
  population. Nobody has submitted anything. HR deactivates it, and the assignment editors come
  back.
- **US-4 — HR replaces a rater who has left.** §12.1 flagged the assignment. HR names someone else
  and the old assignment stops being the ratee's problem.
- **US-5 — HR adds a third rater to someone short of §9.4's three.** The activation gate allows a
  launch only at exactly three, but a departure since launch can take someone to two.
- **US-6 — HR deals with an assessment that is already submitted.** They cannot quietly reassign
  it; they can discard and replace it, and they must say why.
- **US-7 — Anyone reading the audit log can see every one of the above**, who did it, and for the
  destructive one, why.

## Happy path

1. HR opens `/three-sixty` on an `ACTIVE` cycle.
2. The window editor is present (it used to vanish), and accepts a **later** deadline.
3. A rater editor is present per ratee, listing each assignment with its status.
4. HR replaces an unsubmitted rater; the assignment's `raterId` and `templateId` both move, because
   the template type depends on the rater's relationship to the ratee.
5. A **Close cycle** action states what closing does and asks for confirmation.
6. Every write lands an audit row; the destructive one carries HR's reason.

## Worst paths — each one a decision, not an oversight

- **Shortening a deadline after launch.** REFUSED. Extending cannot invalidate work; bringing a
  deadline forward locks raters out of forms they are part-way through, and §5.4 makes a passed
  deadline a hard lock. The 409 says so rather than silently clamping.
- **Moving `opensAt` after the cycle has opened.** REFUSED for the same reason — raters can already
  be inside. Before it opens, it still moves: nobody can have started.
- **Deactivating a cycle with submitted responses.** REFUSED, and the message says to close it
  instead. Taking a cycle back to draft is what lets the bulk regenerate wipe every assignment, and
  it must not be able to destroy submitted assessments as a side effect.
- **Closing a cycle twice.** A no-op answer, not an error, and not a second audit row.
- **Changing the rater on a SUBMITTED assignment.** REFUSED outright. Pointing someone else's
  answers at a new name is not a reassignment, it is a falsified assessment. HR's remedy is the
  discard below.
- **Discarding a submitted assessment.** Allowed, HR only, with a **mandatory reason** (it is the
  one destructive act here). `AssignmentResponse` cascade-deletes with the assignment, so the
  answers are copied into the audit row's `before` FIRST — the trail keeps what was said and who
  said it, and the ratee's average drops that ratio.
- **Removing a rater below §9.4's three.** Allowed but REPORTED: §9.4 wants exactly three, and the
  response says how many the ratee now has so HR is not surprised at §9.8.
- **Assigning a rater who has left, is C-Level, or is the ratee themselves.** Already refused by the
  existing per-ratee writer (§8.3, §12.1, §7.1); the new per-assignment writer must refuse the same
  things, from the same checks, not its own copies.
- **Editing a 360 under a CLOSED performance year.** REFUSED. §2 makes the year finished and its
  360 window part of the record — the existing `PATCH` already does this and the new writers must.
- **A closed cycle that needs reopening.** Allowed (`CLOSED` → `ACTIVE`), because a close that
  cannot be undone is the dead end this project has now produced twice. Refused once the
  performance year is closed.

## Architecture sketch

**One module decides, the routes carry it out.** `lib/pms/three-sixty-edit.ts` holds the
transition rules as pure predicates over `(cycleStatus, performanceYearStatus, dates, now,
submittedCount)` and the assignment rules over `(assignmentStatus, cycleStatus)`. The existing
`answerBlockedReason` in `lib/pms/three-sixty-answer.ts` is the pattern: a gate extracted so the
READ that renders the UI and the WRITE that accepts it cannot disagree. Buttons the API then
refuses are the failure mode being designed out, and the one this screen already has (a promise to
reassign that no writer honours).

**Status transitions** go through a new `POST /api/three-sixty/status` taking an explicit target,
not a toggle — `{ threeSixtyCycleId, status: "ACTIVE" | "CLOSED" | "DRAFT", reason? }`. A toggle
cannot express "close" and "deactivate" as the different acts they are. The existing
`/api/three-sixty/activate` stays as the §9.7 launch, which has its own exactly-three gate.

**Per-assignment edits** go through a new `app/api/three-sixty/assignments/[assignmentId]/route.ts`
with `PATCH` (replace the rater) and `DELETE` (remove, or discard-and-replace a submitted one).
Per-assignment rather than extending the per-ratee `POST`: that writer replaces a ratee's whole set
wholesale, which is right for a draft and catastrophic for a live cycle.

**Shared field lists, per the operator's standing request.** The rater-eligibility checks
(`CANDIDATE_SELECT`, `isThreeSixtyExempt`, the leaver and self-assessment refusals) are reused from
the existing writer, not re-expressed. `templateTypeFor` decides the template on a rater change for
the same reason.

**Audit.** Status changes and rater changes come free from the extension on a single-row update. The
discard is a `delete` whose responses vanish with it, so it writes an explicit `recordAudit` with
the answers and the reason in `before` — the same documented escape hatch the bulk regenerate uses.

## Open questions

1. **Should a discarded submitted assessment be recoverable in the product, not just in the audit
   log?** Preserving it would mean an `EXCLUDED` member on `AssignmentStatus` so §9.5 skips it while
   the responses stay — a schema migration, which is Ask-before. Shipping the audit-row version
   first because it needs no migration and loses nothing from the trail; flagged for the operator.
2. **Should extending a deadline notify the raters?** §9.7 has automated reminders. An extension
   silently changes what they were told. Out of scope here (no mail on this path today) and worth
   its own decision.
3. **Should closing a cycle be reversible forever, or only within the performance year?** Built as
   "while the year is open", which is the narrower, safer reading of §2.
