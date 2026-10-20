# Blueprint — the employee's year-end self-assessment (§7.1)

Scope: app/api/year-end/**, components/pms/MyYearEnd.tsx, lib/pms/year-end-select.ts

**Status:** built 2026-10-20 (UAT Scenario D, operator-directed)
**Supersedes nothing.** The umbrella PMS blueprint still owns §7 as a whole; this covers the one
step that had no reachable surface.

## Problem

§7.1 is an ordered clause: _the employee self-assesses against each KPI, then the manager reviews,
then both sign._ The first step had no way in.

The assessment screen existed and was correct — `YearEndAssessment` has always handled
`actingAs: "EMPLOYEE"`, and `/year-end/<cycleId>/participants/<participantId>` sets it for the
subject, so an employee who guessed that URL got exactly the right thing. What was missing was a
door, and three separate things claimed otherwise:

1. the sidebar entry sat inside the `lineManager || HR_SUPER_ADMIN || HRBP` block, with a comment
   saying the employee's own assessment "reaches them through My Tasks";
2. `/year-end` refused a plain employee with copy repeating that claim;
3. My Tasks built goal-setting and 360 cards only — there was never a year-end one.

So the failure was not a missing feature. It was a missing route plus two confident signposts
pointing at it. An HR tester reading the refusal would reasonably conclude the feature worked and
their fixture was wrong, which is how this survived to UAT.

## User stories

- **As an employee**, I want to find my year-end self-assessment without being told where it is,
  so that the first step of my review is something I can actually take.
- **As an employee part-way through**, I want to see how many KPIs I have left, so that I can come
  back to it rather than restart it.
- **As a manager**, I want my own assessment visible without it burying the roster I came to work.
- **As HR**, I want an employee who cannot yet assess to be told WHY, so that I am not fielding
  "the screen is empty" when the real answer is "their baseline was never approved".

## Scenarios

### Happy path

The year-end window is open, the employee's KPI set has an HR-approved baseline, they are not
C-Level. The home page shows **Your year-end self-assessment** with the lock date and _Start my
assessment_; the sidebar shows **Year-end assessment**. Either opens the rating form: five
descriptors per KPI, an optional comment, Save rating per KPI, then Sign. After signing, the task
disappears and the next move is the manager's.

### Worst paths

| What is true                          | What the employee sees                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not enrolled in the open cycle (§3.5) | "You are not enrolled in the {year} cycle yet… HR adds people to an open cycle from Performance cycles." No task card.                                                |
| No HR-approved baseline (§5.1)        | The screen renders with the server's own sentence: there is nothing to assess against. The task card carries the same sentence, so nobody clicks through to find out. |
| Window not open yet (§5.4)            | Stage banner says so; no task card — it is nobody's move.                                                                                                             |
| Deadline passed (§5.4)                | The card STAYS, marked overdue. §5.5's ladder is already escalating; hiding it would hide the reason.                                                                 |
| C-Level (§8.3)                        | Exempt — no card, no form, the categorical explanation on the screen.                                                                                                 |
| Already signed                        | No card. The assessment is finished and §7.1's next step belongs to the manager.                                                                                      |

## Architecture

- `GET /api/year-end/me` — the employee's own read. **No `employeeId` parameter**, the rule
  `/api/mid-year/me` follows: a route that takes one has to defend it, and this one has nothing to
  defend because the only subject it can return is `actor.employeeId`. §4.5 — salary is never
  selected; the employee columns are the three `ratingBlockedReason` needs.
- `lib/pms/year-end-select.ts` — the KPI select, ordering and serializer, read by BOTH the
  manager's participant page and this route. Not a convenience: §6.2's HR review screen broke a day
  earlier _because_ it kept its own hand-written field list while the shared one grew new columns,
  and two independent selects cannot disagree out loud.
- `components/pms/MyYearEnd.tsx` — `full` renders the real `YearEndAssessment`; `summary` renders a
  one-line pointer. The manager page gets `summary` because the full form pushed the roster ~1,100px
  down, measured by looking at the page.
- `buildYearEndTasks` in `lib/pms/tasks.ts` — the My Tasks card, with the four silent cases above.

**Nothing about permission changed.** `ratingBlockedReason` remains the single arbiter, and this
route calls the same function the manager's page and the write route call. Reachable is not
permitted; the screen now names which it is.

## Open questions

1. **Should an employee be able to revise a rating after signing?** Today signing is final for
   their side and only HR can unwind it. §7.1 does not say. Not invented here.
2. **Should the manager be notified when an employee signs?** §7.1 implies a handoff; §5.6's
   notification set does not include one. Left alone rather than guessed.
