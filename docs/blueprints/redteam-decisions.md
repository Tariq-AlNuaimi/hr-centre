# Blueprint — acting on the red team's two operator decisions

Scope: lib/pms/three-sixty.ts, lib/pms/import/loaders/xlsx.ts, lib/pms/import/run.ts, app/api/scorecard/route.ts, app/api/imports/[id]/apply/route.ts, app/[locale]/(dashboard)/scorecard/**, messages/**, docs/demo/DEMO-CAST.md, docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md

Feature parity: n/a — neither of these is a product category with competitors. Both are the repo
acting on findings its own red team raised against `docs/verification/DELIVERY-REPORT.md`, with the
choice made by the operator rather than the build.

Confirmed: 2026-08-26 — operator, in session, answering four questions put to them after the red team
reported. The two that change code are below; the two that produce documents are noted at the end.

> Full track: touches `lib/**` and two `app/api/**` routes. Governance of record: red-team findings
> R2 and R3 in `docs/verification/REDTEAM-DELIVERY-REPORT.md` and their adjudications in
> `docs/findings-register.md`.

## Problem & outcome

The red team left two questions the build was deliberately not allowed to answer for itself.

**R3 — anonymity.** §13.1 gives the employee combined 360 comments "not attributed to individual
raters, **protecting anonymity**". `consolidateThreeSixty` pooled every submitted form's comments with
no minimum. §9.4 fixes the rater set at exactly three and names the line manager as one of them, so a
lone comment is attributable by elimination. The build could see the hazard; it could not choose the
threshold, because the specification names none and withholding feedback has a real cost.

**R2 residual — scale.** `MAX_ROWS = 10,000` was a number nobody had measured, and the route's real
ceiling is Vercel's function duration. The build could measure; it could not decide between raising
the plan and lowering the cap, because one of those costs money.

**Outcome:** both are now decisions of record with the operator's name on them, implemented, and
stated in the reports rather than carried as open risk.

## User stories

- **US-1 — an employee whose 360 came back thin.** They open their scorecard and are told, truthfully,
  that too few people answered for the comments to be shared anonymously. They are not told "nobody
  wrote anything", and they still see their 360 score.
- **US-2 — an employee whose raters simply left the box empty.** They see the ordinary empty state. A
  privacy notice here would be a lie they could act on.
- **US-3 — an employee with two or more submitted forms.** Unchanged: pooled, sorted, unattributed.
- **US-4 — HR uploading an oversized sheet.** The file is refused at the door with the reason and the
  remedy, before anything is written, rather than failing halfway through the apply.
- **US-5 — HR uploading a normal sheet.** Nothing changes.
- **US-6 — the operator raising the ceiling later.** One number moves, and the comment beside it says
  what has to change first.

## Happy path

1. `consolidateThreeSixty` counts submitted forms and returns `{ level, comments, submittedForms,
commentsWithheld }`.
2. Below `MIN_FORMS_FOR_COMMENTS = 2` **and** with comments present, the list comes back empty and
   `commentsWithheld` is true.
3. `/api/scorecard` passes the flag through; the scorecard renders one sentence in place of the list.
4. The 360 **score** is unaffected on every path.
5. `loadEmployeesFromXlsx` refuses a sheet over `MAX_ROWS = 2,000` with a message naming the limit,
   why it exists, and what to do instead.

## Worst paths — the ones that decide the design

- **Withheld vs. empty must never be confused.** Two different facts; an employee acts differently on
  each. `commentsWithheld` is true only when comments EXIST and are being held back.
- **The threshold must count forms, not comments.** Three raters of whom one wrote is a pool of three
  and stays anonymous. Counting comments would withhold that one wrongly, and would leave a two-form
  pool published because both wrote — the opposite of the rule.
- **HR must not lose the full comments.** §9.8's individual 360 report is a different route
  (`/api/three-sixty/results`) with its own consolidation, so the floor here does not touch it.
  Asserted, not assumed: `consolidateThreeSixty` has exactly one caller.
- **The score must keep publishing.** Withholding a figure §9.5 already used, and that HR can see the
  rater count for at calibration, would read as data hidden from the employee.
- **A cap and a timeout that disagree are worse than either alone.** `MAX_ROWS` is derived from
  `maxDuration`, and `APPLY_TX_BUDGET` is capped below it — a Prisma timeout outliving its own
  function produces a dead request instead of a clean rollback.
- **No silent truncation, no chunked apply.** §3.5's all-or-nothing is what makes the preview worth
  reading; a half-applied org chart is what Appendix A exists to prevent. Refusal is the only honest
  option at the boundary.

## Architecture sketch

**The floor lives in `consolidateThreeSixty`**, not in the route, because the anonymity rule is a
property of the shape returned — which is what that function's own doc comment already claimed and is
what makes it testable without a database.

**The cap lives in the loader**, beside `MAX_UPLOAD_BYTES`, with the arithmetic that produced it
written out: measurement → Neon factor → reserved share of `maxDuration` → rows. A number with its
derivation attached can be re-derived when one input changes; a bare constant cannot.

## Open questions

1. **Does Rihal want the 360 floor at two or three?** Two is the operator's call for this build. Three
   is stricter and would withhold most written feedback in a real cycle. Revisit after one live cycle,
   when the real submission rate is known rather than assumed.
2. **Does the Vercel plan change?** If it does, `maxDuration` and `MAX_ROWS` move together, and the
   comment on each names the other.

## Also produced by the same four decisions (documents, no code)

- `docs/demo/DEMO-CAST.md` — the five people who sign in for the demo, which clause each demonstrates,
  and how to give each one a password. Operator chose this over configuring the IdP before the demo.
- `docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md` — §6.2, §7.1 and §8.7 as three questions for the HR
  team, each with what the build does today and the single question that settles it.
