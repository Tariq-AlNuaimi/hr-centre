# Blueprint — Hiring slice 4: interviews, panel and the decision

Part of `docs/blueprints/hiring.md` (the module contract; ACs AC4.1–AC4.3 live there). This file
records what slice 4 builds and how it was verified.

Scope: app/api/hiring/interviews/**, app/api/hiring/panel/**, app/api/hiring/evaluations/**, app/api/hiring/requisitions/**, app/[locale]/(dashboard)/hiring/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**

## Stories

- As HR, I set a requisition's round plan (which rounds, in what order, how long, which
  competencies each one assesses), schedule each finalist's interviews with a panel, and see the
  whole schedule as a list or a month calendar — with who has confirmed.
- As a panelist, I see my interviews, prepare from a brief of facts only (no fit score, no other
  views, no nationality or contact details), take private notes during the interview, score each
  competency against its behaviour anchors, cast my vote and submit — and only then see the AI and
  the rest of the panel. If that changes my mind I can revise, and my reason is kept.
- As HR, I record a scorecard on a panelist's behalf (a paper form), correct one, and export them.
- As the hiring manager or HR, I compare the finalists competency by competency, see each
  panelist's verdict and comment and who has not reported, and select the preferred candidate
  with a written note — which moves them to the decision and opens the package request.

## Scenarios

Happy: four finalists → round plan Technical (60 min) then Final (45 min) → HR schedules eight
interviews, each with two or three panelists → panelists confirm, download the calendar entry,
prepare, score and submit → the comparison shows means over submitted cards only, 100% coverage,
a unanimous hire for one → HR selects them with a note → Decision pending, package requested.

Worst:

- The referrer is put on their own referral's panel → refused (422). If an older panel already
  has them, removing them is allowed (D8) and scoring is refused (403).
- A panelist opens another panel's brief, score or compare by URL → 404, as if it did not exist.
- Someone who has lost hiring access is added to a panel → refused: every panelist must hold
  `hiring.view` for the requisition's company.
- The preferred candidate has not cleared a required step → selection is refused before anything
  is marked (Interview Hub marked them preferred first, leaving a half-selection).
- Two of six scorecards are outstanding at selection → allowed, and the number outstanding at that
  moment is stored with the selection and shown.
- The brief's notes autosave fires while the panelist has a half-scored draft → the save carries
  notes only and the draft's scores, vote and evidence are kept (Interview Hub's autosave
  replaced the draft's scores with nothing).
- Panel AI mode is "off" → compare never unlocks and says why; revision is refused.

## Architecture

- `lib/hiring/interview-rules.ts` (round order, plan resolution, schedule/RSVP status, reveal
  rule), `scorecard-math.ts` (normalised scores, means over submitted, coverage, verdict,
  divergence), `ics.ts` (RFC 5545, CR-stripped) — pure.
- `lib/hiring/interviews.ts` — scoped loads (panel-only readers limited to panels they sit on),
  round plans, panel checks (≤12, recusal, access). `interview-write.ts`, `interview-views.ts`.
- `lib/hiring/panel.ts` — the panelist side: every call loads the interview only if the actor is
  on its panel. `evaluations.ts` — HR's scorecards. `comparison.ts` — finalists, matrix,
  feedback, select / reject / clear preferred.
- UI: `components/hiring/interviews/**`, `panel/**`, `evaluations/**`,
  `requisitions/{RequisitionSchedule,BriefEditor,ComparisonView,ComparisonDialogs}.tsx`.
- No migration: the slice-1 data model already carries interviews, panelists, scorecards, round
  plans and the preferred-candidate columns.

## Changes from Interview Hub

- D7: the panel brief returns employer, summary, experience (title, company, period, description)
  and skills only — never the raw extracted profile, nationality or contact details.
- D8: removing a recused (referrer) panelist is always allowed.
- D14: the panel compare's AI column is the interview's own transcript analysis — the only AI
  judgement still produced; the "devil's advocate" card read an insight kind no longer produced
  and is not ported.
- Interview search searches candidate names (Interview Hub accepted a search box and ignored it).
- The interview's requisition is the candidate's own; Interview Hub let them disagree.
- Selection checks the gate before marking anyone preferred; "clear selection" is new (Interview
  Hub's copy pointed to a reversal that did not exist), and releases held rejection notices.
- The comparison matrix rows are what the rounds assess (each round's competencies, plus the
  requisition's when a round has none). Interview Hub used the requisition's list alone, so every
  round-specific score was missing from the matrix. HR's on-behalf form scores the round's list too.
- The outstanding-scorecards notice names the candidate as well as the panelist.
- The evaluation page's "Bias check" panel always read "Clear" and called a removed AI kind — not
  ported. A draft's placeholder vote is never shown as the panelist's vote.

## Open questions

- None blocking. The panel AI mode is a hiring setting (default blind); its settings screen and
  the transcript analysis itself arrive with slice 7.
