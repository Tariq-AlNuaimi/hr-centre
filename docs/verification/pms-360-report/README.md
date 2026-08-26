# Verification — §9.8's individual 360 report (red-team F6, F8, and a new F10)

Date: 2026-08-26 · Spec: §9.5, §9.8, §13.1, §13.6, §9.1 · Fixes:
`docs/verification/SPEC-REDTEAM.md` F6, part of F8, and F10 (found here)

`GET /api/three-sixty/results` had no caller. §9.8's three sentences — "calculate 360 score per
employee, consolidate written comments per employee, generate individual 360 reports" — were all
implemented on the server and reachable by nothing. This is that report, plus the window-amendment
gap the verification uncovered on the way to it.

## 1. Result

| Check                                                                        | Result                      |
| ---------------------------------------------------------------------------- | --------------------------- |
| §9.8 report, driven end to end from an empty database state                  | **passes** (§3 below)       |
| Complete case — three raters submitted                                       | 4.58 / 5, ratio 0.917       |
| Degraded case — one rater submitted (F8)                                     | 4.69 / 5, **stated as 1/3** |
| axe serious/critical, complete report, {en,ar}×{light,dark}×{desktop,mobile} | **0** (`axe-results.json`)  |
| axe serious/critical, degraded report, same matrix                           | **0** (`axe-short.json`)    |
| axe serious/critical, §9.1 window editor, same matrix                        | **0** (`axe-window.json`)   |
| One AA contrast failure found and fixed                                      | §5 below                    |
| Pre-push review findings, all fixed and re-verified                          | 42 (§6 below)               |
| `npm run ship`                                                               | green                       |

## 2. What was built

### `components/pms/ThreeSixtyResultCard.tsx` — the report itself

On **the person's record**, not on the 360 console. That is not a filing preference. The console's
own header states the rule: it shows _who was assigned to rate whom_ (§9.4, which HR must see), and
"a screen that pairs who was assigned with what came back is the join that defeats [§13.1's
anonymity]". So the two never appear together. §13.6 already sends HR and the executive viewers to
the individual record for "full drill-down on demand into any individual's complete record", which
is exactly what this is.

It is gated on `capabilities.orgWide` — the same capability the route enforces — so a line manager
never fires a request that will 403, and never sees a placeholder implying a figure exists.

Three deliberate choices inside it:

- **The rater count is stated next to the score.** §9.5 averages "the 3 ratios"; when fewer arrive
  the average is taken over what exists. That is defensible (dividing by a hard 3 would punish a
  ratee for a rater's departure) but it was invisible everywhere. Here the count sits beside the
  figure, and below three it also carries a sentence saying the sample is smaller than §9.4
  intends. See §6 for what remains open on F8.
- **Comments are grouped by question, not listed flat.** §9.8 says "consolidate"; a flat list also
  lets a reader count entries per question and start inferring how many raters said something,
  which is a step towards unpicking §13.1. Under one heading, the texts are just texts. The route
  had already stripped every rater and assignment id before they left the server.
- **The ratio is shown to three places.** It arrived as `0.91666666666666666667` — twenty decimal
  places of a Decimal nobody reads. `levelEquivalent` is the figure §8.5 consumes; this is the
  supporting fraction.

### `PATCH /api/three-sixty` + `components/pms/ThreeSixtyWindow.tsx` — F10

Found while trying to verify the above. The 360 window (`opensAt`, `deadline`) was **write-once**:
`POST` set it, there was no `PATCH` and no `DELETE`, and §9.1 permits only one 360 per performance
year. A cycle created with a mistyped date was wrong for the rest of the year, with no path back —
and §5.4 makes a deadline a hard lock, which is precisely why the mistake has to be correctable
before anyone is standing behind it. The fixture used here had a 360 opening three months in the
future and nothing in the product could bring it forward.

Draft only. Once §9.7 activates the cycle the dates are in every rater's task list, and moving a
deadline underneath someone half-way through a form is a different act from fixing a typo — one §9
does not ask for. The card disappears at activation rather than failing at the click.

## 3. The journey, driven end to end

Every step below went through the browser against a production build. Nothing was written to the
database directly — that shortcut is what let the original red-team gaps hide (see §7).

| Step                                                        | Expected                               | Result |
| ----------------------------------------------------------- | -------------------------------------- | ------ |
| Open `/three-sixty` on a draft cycle                        | window editor present                  | ✅     |
| Move the window from 1 Nov to 1 Aug (F10)                   | accepted; header re-reads 8/1/26       | ✅     |
| §9.6 — fill every short rater set through the dialog        | 26 short → **0 short of 33**           | ✅     |
| One ratee's set held a rater who had since **left** (§12.1) | route refuses the whole set            | ✅     |
| Remove the leaver, add two active colleagues, save          | accepted                               | ✅     |
| §9.7 — Activate                                             | button enabled only at 0 short; ACTIVE | ✅     |
| Provision two rater logins through `/users/new`             | created, linked on first sign-in       | ✅     |
| Three raters each answer the §9.3 form for one ratee        | Submit disabled until complete, then ✓ | ✅     |
| One rater only answers for a second ratee                   | submitted                              | ✅     |
| Open the first ratee's record                               | **4.58 / 5 · 0.917 · 3 of 3**          | ✅     |
| Open the second ratee's record                              | **4.69 / 5 · 1 of 3 + the warning**    | ✅     |
| Comments on both                                            | grouped by question, no rater identity | ✅     |

Captures: `09-report-complete.en.light.png`, `09-report-short.en.light.png`, plus the full
`form.*` / `short.*` / `window.*` matrices.

### The §12.1 refusal was not staged

It happened. A ratee's generated rater set still contained someone recorded as a leaver during the
earlier edge-case verification, and `POST /api/three-sixty/assignments` refused the entire set with
"1 of those raters have left (§12.1) — choose someone else." HR's way through is the §9.6 dialog:
remove them, add a replacement. Capture: `04-leaver-in-rater-set.en.light.png`.

## 4. What this proved that the code could not

The 360 module had never been run end to end by a human path — the earlier F1 verification drove one
form, but no cycle had ever been carried from a draft window through activation to a computed,
readable result. Doing it surfaced three things no test would have:

1. **The window could not be corrected** (F10) — a hard block on ever activating a cycle whose dates
   were typed wrongly.
2. **26 of 33 ratees could not reach three raters** from the generator alone, so §9.7's gate would
   have held the cycle shut in a real Rihal-sized org. §9.6's dialog is the only way through, which
   is why F5 mattered more than its severity suggested.
3. **A leaver inside a generated rater set blocks the save**, and the only remedy is the same
   dialog.

## 5. One accessibility defect, found and fixed

`.text-primary` on the manager link of `/people/[id]` — 4.43:1 on light (AA wants 4.5) and 3.01:1 on
dark. It failed in all eight runs of the first pass. Changed to `text-primary-emphasis`, the token
that exists for exactly this and was already used by nine other components. Re-ran: 0 blocking in
all eight. This was pre-existing, not introduced here; the report card put an axe run on a page that
had not had one.

## 6. Forty-two defects the pre-push review caught

Eight review rounds, none of them visible from the screen. Rounds four to six are almost entirely the
review finding defects in the previous round's fixes, which is the honest shape of this kind of work
and is left visible here rather than tidied into a single "fixed" line. All were fixed before the push, driven
again in the browser, and the matrices above were re-run afterwards.

### First round

1. **A failed request rendered as an absence.** Neither query checked `isError`, so a 429 or a 500
   on the results fetch produced "No 360 forms have been submitted for this person yet." — a
   statement a reader would act on. There is now an explicit failure state, and a 404 on the cycle
   read (this year has no 360) is distinguished from a request that failed.
2. **The empty state flashed before the data.** A disabled react-query reports `isLoading === false`,
   so while the cycle LIST was still in flight the card asserted "no 360 cycle" and then
   contradicted itself.
3. **Written comments could be thrown away.** `levelEquivalent === null` was used to mean "nothing
   submitted", but §9.5's ratio is null whenever no scored answer contributed — which a template of
   only open-ended questions produces, and the create schema allows one. The test is now whether
   anything was submitted; the figures show "—" when there is no ratio.
4. **The report was pinned to the open cycle.** With no picker on the record, January's new cycle
   would have put the previous year's 360 permanently out of reach — while the empty state spoke of
   a "selected performance year" nobody could select. The card now carries the same `CyclePicker`
   every other Phase 4-6 screen uses; driven and confirmed switching 2026 ⇄ 2027.
5. **The window editor could PATCH the wrong cycle.** It seeds its inputs from props once, and was
   mounted without a `key`, so switching between two DRAFT cycles reconciled it in place and left
   the previous cycle's dates in the boxes. Keyed on the 360's id; confirmed by switching cycles and
   re-reading the inputs.

### Second round

6. **`assessmentCount` counted ratios, not raters.** The route derived it from the ratios that
   contributed to §9.5's average, so a template of only open-ended questions — which §9.2 describes
   and the create schema permits — would report "0 of 3 raters submitted" on three real submissions,
   with the short-sample warning attached. The route now returns both: `assessmentCount` (submitted
   forms, which is what §9.4's "3 raters" counts) and `ratedCount` (how many fed the average, which
   is what the sample-size caution is about).
7. **The same miscount drove the "not submitted" empty state**, so a 360 whose forms carried only
   written comments would have discarded them and claimed nothing arrived.
8. **A failed `/api/cycles` read looked like an absence.** The state machine did not inspect the
   cycle list's own error, so a failure fell through to "no 360 cycle has been set up" — with the
   picker gone too, since it hides on an empty list, leaving nothing to retry with.
9. **Loading unmounted the whole card, picker included.** Switching cycles made the control the
   reader had just used disappear for two round-trips, taking keyboard focus with it. The header
   now stays and the body shows a silhouette.
10. **`PATCH` was check-then-update.** An activation landing between the read and the write would
    have moved the window on a live cycle — the exact thing its 409 exists to prevent. Now one
    `Serializable` transaction (single-row `update`, so the audit extension still writes its row).
    It also never checked the parent performance year, so a draft 360 on a CLOSED year stayed
    amendable; `POST` refuses that and now so does `PATCH`.
11. **The window form pointed its error at the wrong field.** An empty Opens box disabled Save while
    the "deadline must fall after" message hung under the Deadline input, which was untouched and
    correct. Empty and mis-ordered are now separate conditions.

### Third round

12. **A deadline was saved as midnight UTC of the chosen day**, so §5.4's hard lock
    (`now > deadline`) fired at 04:00 on the deadline morning in Oman and the evening _before_ it
    anywhere west of Greenwich — a whole day of the window silently removed. `CycleForm` had solved
    this for §5's stages with private `startOfDay`/`endOfDay` helpers; those are now
    `lib/date-input.ts`, shared by all three surfaces, and the create path (`ThreeSixtySetup`)
    carried the same defect and is fixed with them.
13. **`toDateInput` read the instant in UTC** while the StatCards above it render local time, so the
    form and the figure printed beside it could name different days.
14. **The short-sample warning appeared with no score to warn about.** Gated on `ratedCount`, which
    is 0 when no form produced a ratio — giving a "—" score, a green 3-of-3 badge and a red warning
    at once.
15. **A serialization failure surfaced as a 500.** Activation writes outside a transaction at READ
    COMMITTED, so the losing side of a genuine race aborts the Serializable transaction (P2034)
    rather than reaching the DRAFT check. Both paths now answer with the same 409 — the window did
    not move.
16. **§13.1: a lone comment was attributable.** Comments come only from unscored questions, and a
    question belongs to exactly one template — one rating direction. A single comment under a
    `LINE_MANAGER_TO_EMPLOYEE` heading is provably the ratee's only line manager, under a banner
    promising the opposite. **Fixed at the route**, not the screen: `GET /api/three-sixty/results`
    now sends `question: null` for any comment standing alone, so no future consumer can
    reintroduce the join by rendering a field it was handed. Where two or more answered the same
    question the label survives — §9.8 asks for consolidation, and unlabelled sentences are not
    that.
17. **`PATCH` never checked the parent performance year**, so a draft 360 on a CLOSED year stayed
    amendable. `POST` refuses that (§2); now so does `PATCH`.
18. **`amendThreeSixtyWindowSchema` had no contract test** though every sibling schema does. Added,
    along with one for the end-of-day rule and one for §13.1's label-stripping.

### Fourth round — the audit fix's own defects

The first cut of the audit fix replaced the re-read with a merge, and the fourth round showed that
was a trade, not a win: a merge that only models some of Prisma's `data` shapes loses the ones it
does not.

19. **The merge dropped every non-number object value** — a `Decimal`, a scalar list, a `Json`
    column. Granting `HR_SUPER_ADMIN` via `data: { pmsRoles: [...] }` would have audited as
    `changes: null`, and §5.3's weightage approvals (which arrive as `Prisma.Decimal`) with them.
    ADR-065 names the audit trail as the compensating control for exactly that grant, so this was
    the most consequential finding of the four rounds. The re-read is back; the projection now
    overlays it, touches only keys already present on the complete `before` (so a relation write is
    skipped without needing a list of operator names), and treats `Decimal`/array/`Json` as values
    and only `{ set }` and the atomic operators as envelopes.
20. **`undefined` was merged as a value**, so this repo's partial-update idiom
    (`data: { name, email: undefined }`) would have fabricated changes on every single-field edit.
    Now skipped.
21. **The Serializable transaction could audit a move that never happened.** The audit row commits
    on a client outside the transaction, so the loser of a real race would get its 409 while
    `audit_logs` recorded the window moving. `PATCH` no longer uses a transaction: one conditional
    `updateMany` (`where: { id, status: "DRAFT" }`) makes the check and the write a single
    statement, and `recordAudit()` runs only when it landed. That needs a single-line disable of
    `no-unaudited-bulk-write`, logged in SECURITY.md §12 as the rule's own documented escape hatch.
22. **`recordAudit` never computed `changes`.** Explicitly-audited writes landed with `before` and
    `after` populated and `changes: null` — the same shape a no-op produces, so the one field
    `GET /api/audit-log` renders as "what changed" said nothing. It now computes them, which also
    improves the recycling-bin restore path that already used it.
23. **§13.1: `orderIndex` re-derived the withheld label.** The same org-wide actor can read every
    template's questions and their positions from `GET /api/three-sixty`, so a comment whose
    question was withheld still carried the position to look it up by. The index no longer leaves
    the route; ordering is applied there.

### Fifth round — the fourth round's own regressions

24. **The overlay invented type differences.** It applied the caller's raw JS value on top of the
    authoritative re-read, and `PUT /api/kpis/[id]` sends `weightage` as a number into a
    `Decimal(5,2)` column while the board resends the whole form on every save — so editing only a
    description would have recorded `weightage: "40" → 40`. The overlay now applies to a key only
    where the re-read still shows the `before` value, which is the signature of the
    in-transaction case it exists for. Everywhere else the re-read is trusted, types and all.
25. **`recordAudit`'s new `changes` diffed hand-built snapshots** whose key sets rarely match, so
    `POST /api/projects` would report `name` as changed on every membership edit. It now diffs only
    keys both sides carry.
26. **§13.1 again: stripping `orderIndex` was not enough.** Comments were accumulated per rater and
    sorted only by question, so ties kept rater order — two peers on two questions came back as
    [P1-A, P2-A, P1-B, P2-B], and the Nth text under every heading is the same person. Each
    question's texts are now sorted by their own content, which breaks the correspondence without
    randomness (which would make the same data read differently on every fetch).
27. **The badge and the warning could contradict each other.** The badge counts submitted forms
    (§9.4's raters); the warning was about the average's sample but said "submitted forms". With one
    unscored template among three, "3 of 3 raters submitted" sat above "averaged over fewer than
    three submitted forms". The warning now names the number of assessments that produced a score.

### Sixth round

28. **`String()` flattened every object to `[object Object]`**, so the overlay's "did this actually
    change" guard skipped Json and scalar-list columns — the exact case the overlay exists for.
    Comparison is now structural for those and textual for the rest, which is what makes a `Decimal`
    and the number equal to it compare equal.
29. **An atomic operator with a `Decimal` operand** (legal on this schema's several Decimal columns)
    fell through to the "it is a value" branch and wrote the operator envelope into `after`. It is
    now detected by name and skipped when it cannot be computed — saying nothing beats saying
    something false.
30. **§13.1, third attempt.** Stripping `orderIndex` was not enough: the groups were still ordered
    BY it, so the position the label was withheld at survived — and the starter set gives all three
    open-ended questions the same index, so the tie-break fell back to insertion order, which is
    rater order again. The whole response is now ordered by its own content (question, then text),
    which is a pure function of the data: feed the same comments in any order and get the same
    answer. Contract-tested that way.
31. **The badge went amber above three raters.** §9.4 asks for exactly three but
    `setAssignmentsSchema` permits up to ten, so four submissions rendered a warning-coloured
    "4 of 3".
32. **A one-day 360 window was rejected.** The form compared the raw `YYYY-MM-DD` strings, but the
    payload it sends runs 00:00:00 → 23:59:59 and both the route and the schema accept it. It now
    compares the instants it will actually send.
33. **Two reads of the same row two statements apart** in `PATCH` — one now, which also removes a
    null case that could never occur.
34. **`recordAudit`'s `changes` under-reports** where a caller's two hand-built snapshots have
    different key sets. Diffing the union would fabricate entries instead, which is worse for an
    audit trail; the intersection is strictly better than the `null` those callers had before. The
    real fix is making those routes' snapshots symmetric, and it is noted in the helper rather than
    silently accepted.

### Seventh round

35. **The window form could crash the console.** `<input type="date">` accepts a six-digit year, and
    `new Date("123456-09-13T23:59:59")` is Invalid — so `toISOString()` threw a `RangeError` out of
    the component body during render. `startOfDay`/`endOfDay` now return `""` for anything
    unusable, and the form treats that as an incomplete field rather than an error to display.
36. **The F10 case was unrepairable by the F10 editor.** `unchanged` compared calendar days, so a
    window stored at midnight UTC — which is every 360 created before defect 12 was fixed — had the
    right day and the wrong instant, and Save sat permanently disabled on exactly the rows that
    needed it. Both comparisons now use the instants the form will send.
37. **An executive viewer got an enabled Save that always 403s.** The editor was gated on
    `capabilities.orgWide`, which covers HR _and_ the executive viewers, while the route is HR-only
    (§4.1). Gated on write capability now.
38. **A `Json` column's value containing a key called `set` was unwrapped** as though it were a
    Prisma operator envelope, recording a fragment of someone's data as the whole column. An object
    now counts as an envelope only when _every_ key is an operator name.
39. **`recordAudit` diffed the raw snapshots** rather than the scrubbed ones, routing around
    `scrub`'s cycle guard — a cyclic snapshot would have thrown from `JSON.stringify` after the
    write committed, which is the "data changed, no audit row, 500" mode that guard exists to
    prevent. It also keeps Restricted values out of `changes`.

### Eighth round

40. **Round seven's own fix hid the writes that matter most.** Scrubbing both halves before diffing
    made a Restricted column compare `"[redacted]"` with `"[redacted]"`, so a salary edit or a
    password reset recorded `changes: null` — the exact writes ADR-065 names the audit trail as the
    compensating control for. `computeChanges` already redacts per field; the diff is back on the
    raw pair, with a `try`/`catch` for the cyclic-snapshot case the scrub was protecting against.
    Contract-tested both ways round.
41. **`!readOnly` was still the wrong gate.** `isReadOnly` is
    `isExecutiveViewer && !isHr && !isLineManager`, so a COO with direct reports is org-wide, not
    read-only, and not HR — and got an enabled Save. `PmsCapabilities` now carries `hr`, the
    predicate the routes themselves use, and it also fixes the same latent mis-gate on §9.6's
    regenerate, §9.7's activate and the per-ratee edit buttons, which were on `orgWide`.
42. **§13.1, fourth attempt.** The label rule counted comment ROWS per question, and nothing stops a
    template carrying the same question text twice — one line manager answering both would reach
    the threshold alone and keep the label that names them. It counts distinct raters now.

### The audit-trail defect the third round exposed, and the operator's call

The review's most consequential finding was not about this feature at all. An audit row written from
inside an interactive `$transaction` recorded the **pre-update** values: the extension's re-read runs
on the client captured at `defineExtension` time, which cannot see an uncommitted write, so `after`
came back stale and `changes` came out `null`. Thirteen routes, silently — including every 360 form
submission. The operator authorised the `lib/prisma/**` fix rather than deferring it.

`projectUpdate` now overlays the update's own `data` onto the re-read row. The re-read is right
outside a transaction and harmless inside one; the overlay is right in both. Neither alone is
sufficient — which round four established the hard way (defects 19 and 20).

Proved on the running app, same route and same action either side of the change:

| `Assignment` UPDATE via `POST /api/three-sixty/responses` | `changes`                                        |
| --------------------------------------------------------- | ------------------------------------------------ |
| Four rows written before the fix                          | `null` — all four                                |
| One row written after it                                  | `status: NOT_STARTED → SUBMITTED`, `submittedAt` |

And on `PATCH /api/three-sixty` itself: `deadline: 2027-10-15T00:00:00Z → 2027-11-20T23:59:59Z`
(note the end-of-day instant, defect 12 above).

One residual, registered: `auditLog.create` still runs on the captured client, so an audit row
survives a rolled-back transaction — a false positive rather than a blind spot. A Prisma query
extension cannot reach the `tx` handle, so closing that needs a different mechanism. `PATCH` sidesteps
it by not using a transaction at all (defect 21); the twelve existing `$transaction` routes still
carry it.

## 7. What is still open on F8

The count is now visible **at the report**. It is still absent from `EmployeeScore`, so the
scorecard, the §13.5 master export, and the §11 bonus derived from them still cannot say how many
raters a 360 rested on. Closing that means a column and a migration — `prisma/migrations/**` is on
CLAUDE.md's Ask-before list — so it stays registered rather than half-done here.

## 8. The trap this verification had to avoid

`prisma/seed-demo-cycle.ts` writes a 360, its responses and the calibration target straight to the
database. That is why the original conformance pass called §9 complete: every screen had data behind
it, and no one had to reach it through the product. This pass deliberately started from a cycle whose
360 had **zero submitted assignments** and drove every write through the UI — the window, the rater
sets, the activation, the user provisioning, all three forms. The seeder is a fixture for looking at
screens, never evidence that a path exists.

## 9. Still open from the red-team report

F1–F6 and F10 are closed. **F8** is partly closed (§7 above). **F9** — no §5.5 reminder or §9.7
invitation is sent unless SMTP is configured — remains as registered in `docs/findings-register.md`.
