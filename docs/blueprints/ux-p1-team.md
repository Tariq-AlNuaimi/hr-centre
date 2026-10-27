# UX review P1 — phase 5: "My team" across modules and "My hiring"

Scope: lib/people/team-overview.ts, lib/hiring/my-hiring.ts, app/api/team/overview/route.ts, app/[locale]/(dashboard)/team/**, components/people/TeamOverview.tsx, components/hiring/MyHiringReview.tsx, lib/nav/**

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1".
Source: UX review shell/people R14; tickets/hiring P1-9. Re-verified on `main` at 3de685f.

## Why

A line manager's work is split: reviews in My team, goals in Goal setting, a joiner arriving only
on the JML case, interviews in Hiring. Hiring managers have no landing page: they find their own
requisitions through the generic list and decide on candidates nowhere in particular.

## Stories and acceptance criteria

### US-1 — My team across modules (R14)

- AC-1.1 `/team` opens with a cross-module overview above the Performance roster: active direct
  reports, people joining the team (pre-joiners + joiner cases), and either "My open requisitions"
  (for hiring managers, linking to My hiring) or leavers; then a list of joiner / mover / leaver
  cases in flight for people who report to me, each with its key date (start, effective date, last
  day) and a link to the person's record.
- AC-1.2 Keyed on the viewer's own reporting line (`Employee.managerId = me`) and own
  requisitions; `GET /api/team/overview` takes no id. Only who / which case / key date — never the
  checklist, pay or exit details. Bounded (grouped count, ≤ 20 cases, one count).
- AC-1.3 Hidden at org scope (HR line-manages nobody; the roster below is the whole org).

### US-2 — My hiring (tickets P1-9)

- AC-2.1 My team gains a "My hiring" tab (`/team/hiring`) for anyone who may own a requisition (`hiring.hiringManager` or `hiring.manage`)
  (a hiring manager who manages nobody in Performance sees My team with only this tab).
- AC-2.2 "Waiting for your decision": candidates on my requisitions at Shortlisted or Decision
  pending, oldest first (≤ 30), name + requisition + stage + days waiting — no contact or
  protected data. Advance (next linear stage) or Reject with a required note, through the existing
  stage route, so every gate and scope check applies and its refusal is shown verbatim.
- AC-2.3 "Job descriptions to sign": my requisitions whose JD awaits sign-off and whose current
  version lacks my hiring-manager signature.
- AC-2.4 "My requisitions": live requisitions I own with days open and candidates per phase
  (Apply · Screen · Interview · Evaluate · Decide · Offer · Hire; rejected/withdrawn excluded).

## Scenarios

- Happy: a manager sees "Omar — Leaving · last day 30 Nov 2026" and opens Omar's record.
- Happy: an HM advances Sara from Shortlisted; the list refreshes.
- Worst: advancing skips a mandatory step → the route's 422 sentence shows under the buttons.
- Worst: a non-HM opens `/team/hiring` → 404.

## Architecture

`lib/people/team-overview.ts` → `GET /api/team/overview` → `TeamOverview` on `/team`.
`lib/hiring/my-hiring.ts` → server page `/team/hiring` → `MyHiringReview` (client) →
`PATCH /api/hiring/candidates/[id]/stage`.
