# Blueprint — Hiring slice 3: candidates

Part of `docs/blueprints/hiring.md` (the module contract; ACs AC3.1–AC3.4 live there). This file
records what slice 3 builds and how it was verified.

Scope: app/api/hiring/candidates/**, app/api/hiring/requisitions/**, app/api/hiring/settings/**, app/[locale]/(dashboard)/hiring/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**, lib/storage.ts, lib/pms/import/loaders/xlsx.ts

## Stories

- As HR, I add a candidate by hand (or import a spreadsheet of them for a requisition), and see
  every candidate in my companies as a list I can filter, select and export — or as a board I
  drag across the eight-step spine.
- As HR, I open a candidate's profile: details, the stage rail with the next actions, their CV,
  stage history and — once they reach the decision — the package evidence.
- As HR, I screen a requisition's applicants against the JD and the band, shortlist or reject in
  bulk, send the aptitude assessment, record each result and advance those who pass.
- As an HR Manager, I can authorise skipping a mandatory step — with a recorded reason — when the
  process genuinely allows it; nobody else can.
- As a hiring manager or panelist without HR rights, I see only what my role allows: no contact
  details, CV, national ID, DEI answers, AI text, pay or notes.

## Scenarios

Happy: a requisition goes live → 30 applicants imported → screening shortlists 6 (each walks
through CV screened) → 6 are sent the assessment → 5 results are recorded → 4 advance to the
first interview (one held by the hard cut-off) → the board shows them at Interview.

Worst:

- A rejected finalist is reopened and dragged straight to Offer → the gates are named (first
  interview, decision, package), only an HR Manager may confirm, and the reason is written to
  the stage history.
- A finalist is rejected while the preferred candidate's offer is still open → their notice is
  held for five working days on HR Centre's working calendar (Sun–Thu, public holidays); when the
  preferred candidate accepts, or withdraws, the holds are released.
- Blob storage is not configured → the CV and evidence uploads say so plainly (503,
  `STORAGE_NOT_CONFIGURED`), every other part of the profile works.
- A bulk move of 500 includes candidates past the first interview being rejected → those are
  skipped and counted, never moved.
- Two people move the same candidate at once → the second gets a 409 (CAS on the stage), not a
  lost update.

## Architecture

- `lib/hiring/stage-rules.ts` + `stage-gates.ts` — the stage machine and gates (pure).
- `lib/hiring/candidate-stage.ts` — `applyStageChange` (one path for every move: stall clear,
  holds, preferred release, seat fill) and `moveStage` (legality → gates → move).
- `lib/hiring/candidates.ts` / `candidate-views.ts` — scoped loads (out of scope = 404; panel-only
  readers limited to their panels), list and board projections.
- `lib/hiring/candidate-files.ts` — private-blob CV + documents (bytes sniffed, signed reads),
  package confirmation; `lib/storage.ts` gains `putPrivateFile`.
- `lib/hiring/screening.ts`, `assessments.ts`, `candidate-bulk.ts` — screening, the assessment
  queue (D3 record result), bulk move/export, spreadsheet import (reusing the ADR-066 loader's
  bounded `readWorkbook`).
- `@dnd-kit/core` for the board (ADR-081), keyboard sensor included.

## Changes from Interview Hub

- Shortlisting at screening walks NEW_APPLICATION through CV_SCREENED first — Interview Hub
  jumped straight to SHORTLISTED, which its own CV-screen gate refused.
- A fit of 0 means "not scored", never "Reject" in the screening verdict.
- Bulk "send email" is not ported (that deployment sent no email); the talent-pool flag and its
  view were dropped earlier (data model); the unused `positions/[id]/matches` route is not ported.
- Assessment invitations and reminders are recorded, not sent — the copy says so.
- The decorative "Run AI CV parsing on import" tick on the import page is gone (the spreadsheet
  import never parsed anything); AI CV parsing arrives with the AI slice.
- Rejecting with a reason also fills the close-out "why" (`rejectionReason`).

## Open questions

- None blocking. The AI screen run, CV auto-fill and bulk CV import land with slice 7.
