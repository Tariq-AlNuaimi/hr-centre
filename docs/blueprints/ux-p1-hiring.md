# UX review P1, phase 9: one hiring vocabulary, a readable board, honest requisitions, per-role careers pages

Scope: lib/hiring/**, lib/validations/hiring/**, app/api/hiring/**, app/[locale]/(dashboard)/hiring/**, app/[locale]/(careers)/**, components/hiring/**

Status: approved by the operator (Tariq) on 2026-10-27 ("build all of P1"). The `/careers/<slug>`
public page is explicitly authorised.
Source: UX review tickets/hiring P1-7, P1-8, P1-10, P1-12.
Re-verified on `main` at e20abe9.

## Why

- Candidates are described in two taxonomies: 15 stages in lists and chips, 8 phases on the board.
- The requisition's progress stepper looks the same as the candidate stepper but means something different.
- The board clips Decide, Offer and Hire off the right edge. It has no requisition or
  hiring-manager filter, and nothing says whose move a card is waiting on.
- Requisitions show "Pending approval" but not whose approval or for how long. Nothing flags a
  requisition that is past its target close date.
- A role on the careers page has no URL, so it cannot be shared or indexed, and its job
  description is cut to two lines.

## Stories and acceptance criteria

### US-1: One stage vocabulary (P1-7)

- AC-1.1 Every stage pill reads as its phase first (Apply, Screen, Interview, Evaluate, Decide,
  Offer, Hire), with the stage itself as a quieter second label ("Interview · Second interview").
  When the two would say the same thing, only the phase shows. Rejected and Withdrawn stay as they are.
- AC-1.2 The candidate list's chips filter by phase. The filter runs server-side (`phase=1..7` maps
  to the phase's stages), and export honours it. Old `?stage=` links keep working.
- AC-1.3 The requisition pipeline's H1 is "Pipeline". Its progress shows as a bar with a count per
  phase, which looks different from the candidate stepper.

### US-2: A readable board (P1-8)

- AC-2.1 Columns scroll horizontally. Fades and arrow buttons show that there is more; Hire is
  always reachable.
- AC-2.2 The global board filters by requisition and by hiring manager, server-side within the
  reader's scope. The per-requisition board is unchanged.
- AC-2.3 Every card shows its fit score ("—" when not scored, as before) and who owes the next move:
  Recruiter, Hiring manager, Panel, Candidate, or Approvers when an offer is out for approval.
  The owner is shown with a coloured marker and a legend.
- AC-2.4 The List/Board switch sits in the page header on both screens.

### US-3: Requisitions say where they are stuck (P1-12)

- AC-3.1 A pending requisition's status reads "Pending: <role> (Nd)". The role is the next unsigned
  step of the current round, computed from the configured chain. N counts days since the round
  was submitted or since the last signature.
- AC-3.2 A "Days open" column is added, with the existing amber at 14 days and red at 25. A
  requisition past its target close date while still open is flagged "Overdue".
- AC-3.3 Bounded: one batched read per signal for the page (≤100 rows), never one per row.

### US-4: Per-role careers pages (P1-10)

- AC-4.1 `/careers/<slug>`, where the slug is `<title-kebab>-<id>`, shows the full job description.
  Markdown is rendered as headings, paragraphs and lists, with no raw HTML. The page carries the
  company and department, the posting date, the Apply panel, and share links (copy link,
  LinkedIn). A stale title in the slug redirects to the canonical slug. A role that is not open
  returns 404.
- AC-4.2 The page carries `JobPosting` JSON-LD with title, description, datePosted, validThrough
  (target close, when set), hiringOrganization and jobLocation (Muscat, OM). The JSON is escaped
  so it cannot close its script tag. It also carries a canonical link and Open Graph metadata.
- AC-4.3 The index filters by company and team, and each role links to its page.
- AC-4.4 The same advertised-role rule as the board: OPEN, JD signed, careers posting LIVE. Nothing
  about pay leaves the module. `/careers/*` is already under `CANDIDATE_PATHS`, so no middleware change.

## Worst paths

- **Slug with a missing or bad id.** Returns 404, and nothing reveals whether a draft role exists.
- **Role closed while its page is open.** Apply refuses with "no longer open", as today.
- **Pending requisition whose chain config changed mid-round.** The next step is computed from
  today's chain, the same chain the approval screen uses.
- **JD containing `</script>`.** It is escaped in the JSON-LD and rendered as text in the body.

## Architecture

- `lib/hiring/stage-rules.ts` gains `stagesForStep` and `nextOwner` (pure).
- `lib/hiring/requisition-pending.ts` (new) produces batched pending-step labels for a page of
  requisitions.
- `lib/hiring/careers-jd.ts` (new, pure) holds the slug, the markdown block model and the
  JSON-LD builder.
- `lib/hiring/careers.ts` gains `openRole(id)`, cached on the careers tag.

## Open questions

- Requisitions have no location field. JSON-LD uses Muscat, OM for every role until one is added.
