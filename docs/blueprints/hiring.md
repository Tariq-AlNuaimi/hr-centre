# Blueprint — Hiring module (port of Rihal Interview Hub)

Status: building in slices (operator-authorised overnight build, 2026-10-26). Source of truth for
the port: the Interview Hub trace at `7fef5a0` (the port spec, parts 1–5). Every rule there is a
requirement here unless this document records a deliberate change (§7 defects, §8 decisions).

Scope: lib/hiring/**, lib/validations/hiring/**, app/api/hiring/**, app/api/internal/hiring-retention/**, app/[locale]/(dashboard)/hiring/**, app/[locale]/careers/**, app/[locale]/agency/**, components/hiring/**, components/careers/**, prisma/seed-hiring.ts, tests/contracts/hiring-*.test.ts

> The hiring-steps document (`Hiring_steps HR_Hub.docx`) that Interview Hub's ADR-059 cites is not
> on disk anywhere. The process below is reconstructed from Interview Hub's
> `docs/process-conformance.md`, its stage gates and its artboards, exactly as the port spec does.
> The operator should supply the .docx so HR can confirm the reconstruction.

## 1. What it is

HR Centre's recruitment module: a requisition is raised from workforce planning, approved
(HR Manager → Operations Director), its JD signed by the hiring manager and HR, posted on
channels (careers page, LinkedIn, agency, referral, Tawteen, internal), candidates screened
(AI fit 0–100 + budget fit), assessed, interviewed by a blind-scoring panel, compared, a preferred
candidate selected, their package evidenced, an offer approved (HR Manager → Operations Director,

- COO at ≥ 2,500 OMR total monthly), extended, negotiated and accepted — at which point the hire
  becomes a PRE_JOINER employee with a JML joiner case. Unsuccessful candidates are closed out
  through a human-sent notice queue with 5-working-day holds.

Fifteen documented steps over an eight-step spine:
Requisition · Apply · Screen · Interview · Evaluate · Decide · Offer · Hire.

## 2. Users and access (role builder, not hard-coded roles)

Interview Hub had two role axes (access role ADMIN/EDITOR/VIEWER and an 11-value business role)
plus a user entity. HR Centre has one: role-builder permissions held in a scope. The port maps:

| Interview Hub                                   | HR Centre permission (module `hiring`, all scope-honouring)                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VIEWER (any hiring access)                      | `hiring.view`                                                                                                                                                     |
| EDITOR (operational writes)                     | `hiring.manage`                                                                                                                                                   |
| `canViewComp`                                   | `hiring.viewComp` (also: the hiring manager on a requisition with "hiring manager sees salary"; an approver routed to a step of that offer/requisition)           |
| non-VIEWER PII                                  | `hiring.viewPii`                                                                                                                                                  |
| DEI aggregates                                  | `hiring.viewDei`                                                                                                                                                  |
| access ADMIN (module settings, admin overrides) | `hiring.configure` (Group scope only)                                                                                                                             |
| DSAR export / erasure                           | `hiring.erase` (Group scope only)                                                                                                                                 |
| business role X                                 | `hiring.<role>` — `hrManager`, `hrSpecialist`, `hiringManager`, `panelist`, `departmentHead`, `director`, `operationsManager`, `operationsDirector`, `coo`, `ceo` |

Scope: a hiring record is covered when its requisition's company / department / directorate is
inside an assignment scope for the permission asked (`scopeCovers`). Out of scope = **404**, never
403 (no existence oracle). Entity codes map RHL→RIHAL, TP→TP, CL→CL.

Starter roles (seeded by `prisma/seed-hiring.ts` from `lib/hiring/roles.ts`, editable): Hiring
admin, HR Manager, HR Specialist, Hiring Manager, Panelist, Department Head, Director, Operations
Manager, Operations Director, COO, CEO. As for HR tickets, HR Super Admin is not silently widened:
hiring authority is granted through these roles. Every approver role is assignable (fixes D1).

## 3. Stories and acceptance criteria (by slice)

### Slice 1 — data model, permissions, reference data

- AC1.1 All 32 `Hiring*` models exist with `hiring_*` tables; no clash with core or other modules.
- AC1.2 Six compensation fields are AES-256-GCM ciphertext at rest under `HIRING_COMP_ENCRYPTION_KEY`
  (bound by AAD to their row and field); a sealed column can never be filtered or sorted (they are
  `*Enc` text columns); a contract test proves round-trip, AAD binding and fail-closed on a missing key.
- AC1.3 Restricted hiring fields are in `SCRUB_FIELDS`, the `neon-sql` REDACT list and the export
  denylist, kept in lockstep by the existing tests.
- AC1.4 The catalogue carries the 17 hiring permissions; eleven starter roles are created
  idempotently (never recreated once an admin deletes or edits one).
- AC1.5 The production seed loads, idempotently: grades G1–G9 (monthly OMR bands), 20 competencies,
  12 JD templates, a starter question bank, the approval-chain defaults (floor HR Manager →
  Operations Director, COO threshold 2,500 OMR) and the assessment policy defaults. Budget envelopes
  are NOT seeded.

### Slice 2 — requisitions, planning, JD, posting, knowledge base

- AC2.1 Planning cycles per company: open (dup → 409), canvass ≤100 departments, chase
  non-responders, record submitted/agreed roles, a ≤50-note challenge thread, close/reopen.
- AC2.2 Hiring request: draft or submit; all ten readiness fields on submit; raised only for an
  in-scope company; from a need only when CHALLENGE_AGREED with ≥1 agreed role.
- AC2.3 Two-step requisition approval HR Manager → Operations Director: submitter can never sign;
  one person cannot sign both steps; a fresh round on every resubmission; concurrent sign → 409.
- AC2.4 Status machine (DRAFT … ARCHIVED) with a mandatory reason and history row; edit locks after
  DRAFT; JD edits void the sign-off; seat-fill sync FILLED/REOPENED.
- AC2.5 JD two-signatory sign-off (HM slot = the requisition's hiring manager; HR slot =
  `hiring.hrManager`/`hiring.hrSpecialist`/configure, never the HM, never the drafter).
- AC2.6 Posting console: only OPEN + JD-signed requisitions post; Tawteen forces Omani-preferred;
  per-channel applicant counts.
- AC2.7 Knowledge base CRUD: grades, competencies (+BARS anchors), JD templates (now with grade —
  D16), question bank.
- AC2.8 Out-of-scope requisition reads/writes are 404; POST checks the target company (D-entity).

### Slice 3 — candidates

- AC3.1 Pipeline stage machine; mandatory gates (CV screened, first interview, decision pending,
  offer drafted); package gate; HR-Manager override with a recorded reason; resume-rank after reject.
- AC3.2 `applyStageChange` side effects: stall clear, rejection holds (5 working days, Fri+Sat
  weekend, Asia/Muscat), preferred release, seat fill.
- AC3.3 Kanban board (dnd-kit), candidate profile with tabs, CV upload (private blob, PDF ≤10 MB),
  documents + package confirmation, stall cause, screening (fit 0–100 + verdict vs band),
  assessments incl. **recording a result** (D3), bulk actions (≤500, governed moves skipped),
  import (xlsx) and exports (no comp/DEI/NEC).
- AC3.4 VIEWER projections: no contact, CV, NEC, DEI, AI fit text, rejection notes, package,
  preferred/stall/agency notes. Lists never carry them for anyone.

### Slice 4 — interviews and panel

- AC4.1 Round plan per requisition; schedule interviews with a panel; RSVP; ICS per interview and
  calendar feed; referrer recusal (removing a recused panelist is allowed — D8).
- AC4.2 Panel scoring blind / assisted / off; compare locked until reveal; revise after reveal with a
  reason, audited. Panel brief never returns Restricted data or nationality (D7).
- AC4.3 HR-entered scorecards; comparison matrix (means over submitted only, coverage, verdict);
  select preferred (note ≥20, auto package request) / reject finalist.

### Slice 5 — offers

- AC5.1 Offer status machine; approval-bound fields frozen after DRAFTING; chain snapshot on submit;
  floor + configurable additions + COO on TOTAL monthly comp ≥ threshold; SoD; one person may not
  approve two consecutive steps (D17).
- AC5.2 Revisions (comp change restarts approval), versions (sealed terms), negotiation threads
  (comp roles only), offer letter PDF (monthly wording — D11), acceptance (joining date = offered
  start) runs the OFFER_ACCEPTED side effects (D4), close-out queue + holds.
- AC5.3 Package: request / decline / confirm / reopen; payslip evidence (private blobs).

### Slice 6 — public surfaces

- AC6.1 `/careers` lists OPEN + JD-signed + live-careers-posting roles (no band); apply is rate
  limited, daily cap, case-insensitive duplicate check (D18), **server-side consent** (D2).
- AC6.2 `/agency/[token]`: 256-bit token, only its hash stored, expiry, revocation, max
  submissions enforced under a Serializable transaction, PDF magic bytes, `noindex`, one
  "not valid" state for every failure, server-side consent.

### Slice 7 — AI, insights, retention

- AC7.1 AI kinds jd, fit (0–100), transcript; parse-cv; parse-jd. Provider from Hiring settings
  (Anthropic / OpenAI-compatible) with env fallback; key encrypted; egress allow-rules; budget
  kill-switch / token cap / spend cap; PII redaction; protected-attribute proxies stripped.
  Unconfigured ⇒ a clear disabled state.
- AC7.2 Insights: funnel, KPIs, velocity, Omanization vs target, DEI with min-cell 5 — all
  entity-scoped (D12).
- AC7.3 Retention cron erases expired candidates' PII completely (D6) incl. CV blob by its real key.

### Slice 8 — hand-off to JML

- AC8.1 Pre-boarding checklist (package confirmed OR declined — D5) and handover (Sr HRBP route).
- AC8.2 At acceptance, a PRE_JOINER core Employee is created through `lib/people/write.ts` and a JML
  JOIN case opened; idempotent on the candidate. Withdrawal cancels both.
- AC8.3 Employee record gains a "Hiring" tab (source requisition, offer, panel).

## 4. Happy path

HR opens a planning cycle for Rihal → canvasses Engineering → records 2 roles, challenges to 1 →
raises the requisition → HR Manager signs, Operations Director signs → HM and HR sign the JD →
posted to the careers page → 30 applications → AI screening ranks them → 5 shortlisted, assessed →
two interview rounds, panel scores blind → comparison → preferred selected → payslips reviewed,
package confirmed → offer drafted at 2,800 OMR total → HR Manager, Operations Director, COO approve
→ letter sent, negotiated once (no comp change), accepted → PRE_JOINER employee + joiner case →
handover to junior HR → runners-up notices released and sent from Outlook.

## 5. Worst paths

- An Operations Director in Codeline opens a Rihal requisition URL → 404.
- The submitter tries to approve their own requisition or offer → refused, recorded.
- Two approvers sign the same step at once → one succeeds, the other gets 409.
- The comp key is missing in production → offers cannot be saved; the screen says why (no
  plaintext fallback).
- A candidate rejected at interview stage is reopened and dragged to Offer → gates named, only an
  HR Manager can override, with a reason recorded in the history.
- An agency link is shared after expiry, revoked, or at its cap → the same "not valid" page.
- Blob storage is not configured → uploads show "file storage is not configured"; everything else
  works.
- No AI provider → AI buttons are replaced by a "not configured" state; screening can be done by
  hand.

## 6. Architecture

- **Layers**: UI (client pages + TanStack Query) → `/api/hiring/**` (auth wrapper + zod + scope
  check) → `lib/hiring/**` services → Prisma. Pure rules live in their own modules so contract tests
  import them without a database.
- **Identity**: people references (`hiringManagerId`, `ownerId`, panelists, approvers, signers,
  authors) are core `User` ids held as plain columns; the module never adds relations onto core
  models. Names are resolved in one batched query per response.
- **Org**: `entityId` (→ `OrgEntity`) and `departmentId` (→ `Department`) plain columns, validated
  on write. The hired employee is referenced by `employeeId`.
- **Comp encryption**: explicit seal/open at the service seam (`lib/hiring/comp-crypto.ts`) using
  HR Centre's field-encryption envelope with a dedicated keyring; AAD = `hiring:<model>:<id>:<field>`.
  Chosen over porting Interview Hub's name-keyed extension (ADR-080).
- **Settings**: `HiringSetting {key, value}` — the Interview Hub keys, unchanged.
- **Files**: `lib/storage.ts` private Vercel Blob (`hiring/cvs/<candidateId>/cv.pdf`,
  `hiring/docs/<candidateId>/<docId>`); honest "not configured" state.
- **Public**: `/careers`, `/agency/<token>` pages; `/api/hiring/public/**` routes, rate-limited.
- **Cron**: `/api/internal/hiring-retention` 04:00 daily, CRON_SECRET bearer.

## 7. Defects in the source and what the port does instead

| #   | Port behaviour                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Every approver role is a permission in the role builder → assignable.                                                                   |
| D2  | Careers apply and agency submit require `consent: true` server-side; `consentAt` only then.                                             |
| D3  | "Record result" action on the assessment screen (score, percentile, interview focus).                                                   |
| D4  | Acceptance moves the candidate through OFFER_ACCEPTED (hold release + hand-off) then PRE_ONBOARDING.                                    |
| D5  | Handover checklist clears package evidence on CONFIRMED **or** DECLINED.                                                                |
| D6  | Erasure also clears expectation, all free-text notes, negotiation notes, documents (+blobs), versions; CV blob deleted by its pathname. |
| D7  | Panel brief returns employer/experience/skills only — no nationality, no raw profile.                                                   |
| D8  | Removing a recused panelist is allowed (recusal blocks adding, not removing).                                                           |
| D9  | `?stage=DECISION_PENDING` filters.                                                                                                      |
| D10 | `hmSeesSalary` enforced: the requisition's hiring manager sees its comp only when set.                                                  |
| D11 | Default letter says "monthly basic salary".                                                                                             |
| D12 | Dashboard, counts, velocity, Omanization are entity-scoped and need `hiring.view`.                                                      |
| D13 | `/api/ai/json` and `/api/ai/stream` (freeform/bias-check) are not ported.                                                               |
| D14 | Panel compare reads only the kinds still produced.                                                                                      |
| D15 | Locked-field copy points to "send it back to draft".                                                                                    |
| D16 | JD templates accept a grade.                                                                                                            |
| D17 | One person may not approve two steps of the same offer.                                                                                 |
| D18 | Duplicate pre-check is case-insensitive.                                                                                                |
| D19 | Requisition salary band is comp-gated on every read.                                                                                    |

Dead UI not ported: talent pool (route, segment, "move to talent pool"), careers view counter,
template kanban leftover, Feedback tab, devil's-advocate card, SLA copy; `.csv` import copy removed;
`/settings/agency-invites` becomes `/hiring/agency-invites` (manage-level, matching its API).

## 8. Decisions (ADR-080, ADR-081)

- Onboarding templates/tasks are not ported (JML owns joiner checklists).
- `talentPoolFlag`, `pipelineConfig`, `slaOverrides`, `AiUsage.agentId`, orphan enums dropped.
- `exceljs` replaced by HR Centre's `read-excel-file` / `write-excel-file`.
- Email stays off (ADR-059): steps 4c and 13 are human-sent; comms flags are kept for the banners.
- NEC (civil ID) is encrypted under HR Centre's ID-document key.

## 9. Pages (Interview Hub → HR Centre)

`/` → `/hiring` · `/hiring-flow` → `/hiring/flow` · `/positions*` → `/hiring/requisitions*`
(new, request, `[id]`, edit, approval, jd, posting, pipeline, screening, assessment, interviews,
comparison) · `/positions/planning` → `/hiring/planning` · `/candidates*` → `/hiring/candidates*`
(+ preboarding) · `/pipeline` → `/hiring/pipeline` · `/close-out` → `/hiring/close-out` ·
`/import` → `/hiring/import` · `/interviews*` → `/hiring/interviews*` · `/panel*` →
`/hiring/panel*` · `/evaluations*` → `/hiring/evaluations*` · `/offers*` → `/hiring/offers*` ·
`/approvals` → `/hiring/approvals` · `/competencies*`, `/grades*`, `/jd-templates*`, `/questions*`
→ `/hiring/library/*` · `/organizations*` → `/hiring/settings` (Omanization target per company) ·
`/admin/roles` → `/hiring/settings/role-matrix` · `/settings*` → `/hiring/settings/*` ·
`/settings/agency-invites` → `/hiring/agency-invites` · `/insights` → `/hiring/insights` ·
`/careers`, `/agency/[token]` → same paths. Core-owned (not ported): auth pages, `/users*`,
`/audit-log`, `/recycling-bin` (hiring models are registered with it), `/settings/profile`,
`/admin`, `/style-guide`, `/settings/onboarding-templates` (JML).

## 10. Feature parity

Feature parity: n/a — this is a port of an existing in-house product; parity is measured against
the port spec's 77 pages and 122 routes (reported per slice in the PR bodies).

## 11. Open questions

- The hiring-steps .docx (see top).
- RoleTrack for a new hire (derived from grade: G1–G4 individual, G5 lead, G6–G7 manager, G8
  director, G9 C-level) — HR to confirm.
- `BLOB_READ_WRITE_TOKEN` on the Vercel project.
