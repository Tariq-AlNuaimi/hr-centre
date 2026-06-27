# Blueprint — Phase 4: Candidate Runner (ARCHITECTURE §12.4, UI-SPEC C.1–C.5)

> Full-track blueprint. The contract for the build; `/qa`/`/uat` trace coverage to
> the user stories below. Sources: ARCHITECTURE §8, §9 (candidate flow), §11
> (consent/PDPL), §12.4 + UI-SPEC Part C. Written at the Phase-3→4 boundary.

## Problem & outcome
A candidate, invited by token link (no account), completes a **bilingual (EN/AR,
full RTL), mobile-first** assessment: consent → 120 IPIP-NEO items (paged,
autosaved) → role-specific SJT scenarios → submit. When this ships, a candidate
can open `/a/[token]`, give PDPL consent, answer at their own pace with
save-and-resume, and submit — and HR has the stored responses needed for Phase 6
scoring/results. This is the brand-critical surface (candidates see Rihal here),
and the first place the platform stores **candidate PII** — so consent capture and
data-class handling are load-bearing, not afterthoughts.

## Market scan
- **TAO / QTI engines** — heavyweight; explicitly NOT embedded (UI-SPEC locked
  decision): the test is 120 Likert + SJT, the hard parts (scoring/norms/i18n) are
  already adopted OSS, so a thin custom runner carries the Rihal brand + Arabic RTL
  better than integrating TAO. Build the presentation runner only.
- **react-hook-form + zod + next-intl** — adopted for the per-screen forms, RTL,
  and the localized item text (items render from `AssessmentItemBank`, never
  hardcoded — UI-SPEC C.2).

## Tier
**shared** — production platform, real candidate PII, PDPL/ISO posture. SECURITY.md
§9 applies. Consent + retention/erasure obligations are in scope from this phase.

## User stories
- **As a candidate, I want to understand what this is and consent before any data
  is collected**, so that my participation is informed (PDPL).
  - Acceptance: `/a/[token]` Step 0 shows what's measured, est. time, no
    right/wrong framing, a plain-language PDPL notice, and a required consent
    checkbox; "Begin" is disabled until checked; consent timestamp + token are
    persisted before any item response is accepted. Invalid/expired/already-
    completed tokens each show a distinct, calm, branded state (not a 500/404 dump).
- **As a candidate, I want to answer 120 items a screenful at a time with my
  progress saved**, so that I can pause and resume without losing work.
  - Acceptance: items render from `AssessmentItemBank` in the candidate's locale
    (AR falls back to EN where `text_ar` is null); ~5 items/screen (tunable),
    journey line shows "Section X of N"; each answer autosaves to `ItemResponse`
    (optimistic + server write) with a "Saved" indicator; reopening the token link
    resumes at the first unanswered screen; Next is disabled until the screen is
    complete; save-failure shows inline retry and never drops answers.
- **As a candidate, I want to answer the role's SJT scenarios**, so that judgement
  is captured alongside traits.
  - Acceptance: one scenario per screen, options from `SjtItem.options`, choice
    saved to `SjtResponse`; the keyed answer is NEVER sent to the client (masked
    server-side); same autosave/resume/error model.
- **As a candidate, I want to switch EN/AR mid-assessment without losing progress.**
  - Acceptance: the language toggle re-renders localized content and flips the full
    RTL layout; answers persist across the switch.
- **As a candidate, I want a dignified completion screen with no score shown.**
  - Acceptance: submit marks the Assessment submitted; a thank-you (no score by
    default, configurable) is shown; re-opening a completed token shows the
    already-completed state (no re-take).
- **Worst paths (every story):** tampered/forged token → generic invalid state, no
  enumeration; answering after submit → rejected; an out-of-range Likert value or
  an option id not in the item → zod 422, not a 500; cross-assessment response
  injection (posting another assessment's id) → 403/404 (the token, not a client
  id, authorizes writes).

## Architecture sketch
**New entities** (ARCHITECTURE §8). **Candidate PII is introduced here** — classify
in SECURITY.md §1 in the same commit:
- `Invitation { id, orgId, roleProfileId, candidateEmail, candidateName?, token (unique, opaque), status (PENDING|OPENED|STARTED|COMPLETED|EXPIRED|REVOKED), expiresAt?, locale, sentById?, batchId?, createdAt }` — **MINIMAL in Phase 4** (the token entry point + candidate identity). The full invite UI / bulk-CSV / email send is **Phase 5**; Phase 4 seeds/creates invitations for testing. `candidateEmail`/`candidateName` = **Confidential PII**.
- `Assessment { id, orgId, invitationId (unique), status (CONSENTED|IN_PROGRESS|SUBMITTED), locale, consentAt?, startedAt?, submittedAt? }` — one per invitation.
- `ItemResponse { id, assessmentId, itemNumber (1..120), value (1..5) }` — `@@unique([assessmentId, itemNumber])` (idempotent autosave/upsert-by-unique). Joins to `AssessmentItemBank.itemNumber` for scoring.
- `SjtResponse { id, assessmentId, sjtItemId, chosenOptionId }` — `@@unique([assessmentId, sjtItemId])`.
- **Result + scoring roll-up are Phase 6** (needs the active role profile + the competency roll-up). Phase 4 stops at captured responses + submit. (Corrects the earlier handoff note that put scoring in Phase 4 — the deterministic `requestScoring` client exists since Phase 2, but the fit/Result composition belongs with the results UI in Phase 6.)

**Token-authorized routes** (NO session — the opaque token authorizes; rate-limit OUTSIDE):
- `GET  /a/[token]` (page, RSC) — resolve token → render the right step/state.
- `POST /api/run/[token]/consent` — record consent (timestamp), create Assessment, flip Invitation OPENED→STARTED.
- `POST /api/run/[token]/response` — upsert one ItemResponse/SjtResponse (zod: itemNumber∈1..120 & value∈1..5, or sjtItemId+chosenOptionId∈ that item's options). Rejected once SUBMITTED.
- `POST /api/run/[token]/submit` — mark SUBMITTED, flip Invitation COMPLETED.
- A new wrapper `withCandidateToken(handler)` in `lib/api-helpers.ts` (Ask-before file — needs care): constant-time token lookup, 404 on miss/expired, attaches the resolved Assessment; audit context stamped with orgId + a null user (candidate is not a User). Rate-limited.

**Where state lives:** DB. Per-screen form state client-side (react-hook-form) until autosaved. Reuses: `AssessmentItemBank` (items), `RoleProfile.sjtItems` (SJT, keys masked), the audit + (no soft-delete on responses) extensions, the candidate-runner shell at `/a/[token]` (NO app nav — separate layout from `/app`). New: a 680px centered candidate layout + the journey-line component.

**Migrations:** one additive migration `add_candidate_runner`. Soft-delete: Invitation + Assessment are recyclable (candidate erasure, PDPL §11); ItemResponse/SjtResponse cascade with the Assessment (hard children). Audit ON for all.

## The five pillars
- **Speed** — per-screen reads, autosave is a single upsert, RSC for the page shell.
- **Maintainable** — reuses the item bank, role-profile SJTs, audit; one new auth wrapper + one service.
- **Scalable** — responses keyed by `(assessmentId, itemNumber)` upsert (no dupes, no N×1); a candidate's reads are bounded to their own assessment.
- **Secure** — token (not a guessable id) authorizes every write, constant-time lookup, orgId stamped, SJT keys never sent client-side, zod on every response, consent gated before any item write, candidate PII classified + erasure path. Rate-limited (public surface).
- **High-Quality** — designed token states (valid/expired/completed/invalid), save-failure retry that never loses answers, RTL + AR (no English fallback for chrome), mobile-first @360px, axe-clean, reduced-motion honored.

## Open questions (resolve at build time; defaults proposed)
- [ ] **Token format** → opaque, high-entropy (e.g. 32-byte base64url via `crypto`); stored as-is (Phase 4) — consider hashing at rest in Phase 5 when invites are bulk-generated. *Default: opaque random, unique, indexed.*
- [ ] **Items per screen** → 5 (→ 24 screens), configurable. *Default 5.*
- [ ] **Skips / prorated scoring** → default require-all-on-screen (no skips) for v1; revisit if HR wants prorated.
- [ ] **Candidate PII data-class + erasure** → `candidateEmail`/`candidateName` Confidential; wire into the existing recycling-bin/erasure path; confirm retention default with operator (PDPL).

## ⚠️ Run the deferred Phase-3 gates FIRST
Phase 3's `/code-review`, `senior-code-reviewer`, and `/design-qa` were deferred
(context limit) and have NOT run. Run them before/at the start of Phase 4 so the
runner isn't built atop unreviewed authoring code.
