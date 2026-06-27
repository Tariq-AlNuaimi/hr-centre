# Blueprint — Phase 3: Role-Profile Authoring (ARCHITECTURE §12.3)

> Full-track blueprint. Contract for the build; `/qa`/`/uat` trace coverage to the
> user stories below. Source of truth: ARCHITECTURE.md §§4–7, §12.3 + UI-SPEC D.2–D.4.

## Problem & outcome
HR Admins need to turn a job description into a **standards-anchored, versioned
target competency profile** for a role family, with every competency traceable to
an O\*NET work-style + Big-Five literature citation. Today nothing exists between
the seeded `RoleFamily` taxonomy and the (future) candidate runner — there is no
object to assess *against*. Phase 3 ships the authoring layer: create → AI-draft
(bounded) → human edit → approve → activate, fully versioned and audited. When it
ships, an HR Admin can stand up an approved, active role profile that Phase 4's
runner and Phase 6's scoring roll-up will consume.

This phase also introduces the platform's **first bounded LLM use** (AI Role 1 —
profile drafting with mandatory human approval, ARCHITECTURE §4). The LLM is a
*runtime-config seam*: drafting is gated behind an env-configured endpoint and the
entire feature works (manual authoring) with it unset.

## Market scan
- **Bryq / pymetrics / HackerRank-style role profiling** — proprietary AI infers
  weights against undisclosed norms; you cannot inspect *why* a trait was weighted
  (ARCHITECTURE §2). We deliberately build the inverse: every competency cites its
  O\*NET ref + literature, human-approved, versioned. Build (not adopt) is correct
  here — the auditability *is* the product differentiator (PDPL/ISO posture).
- **shadcn/ui + react-hook-form + zod** — adopted wholesale for the wizard/forms
  (UI-SPEC F). We build only the Rihal-branded composition, not primitives.
- **LiteLLM (OpenAI-compatible)** — adopted as the LLM gateway shape; we call an
  env-configured OpenAI-compatible `/chat/completions` endpoint, never a hardcoded
  public provider (ARCHITECTURE §10).

## Tier
**shared** — multi-tenant product, real users (HR_ADMIN / HIRING_MANAGER), PDPL/ISO
audit posture, `/handoff` target. SECURITY.md §9 obligations apply. (One reason:
it is the Rihal production platform, not a disposable prototype.)

## User stories
- **As an HR_ADMIN, I want to create a role profile from a JD and have the system
  draft competencies for me**, so that I start from a standards-anchored skeleton
  instead of a blank page.
  - Acceptance: `/app/roles/new` accepts role family + title + JD; if the LLM seam
    is configured, "Draft with AI" returns an editable competency table labelled
    "AI-drafted — review before approving"; if unset, the same wizard works with a
    blank/starter-cloned table and the AI control is absent/disabled with a clear
    note. Nothing the AI returns is persisted as approved without an explicit human
    approve action.
- **As an HR_ADMIN, I want to edit competencies, mapped facets, target bands,
  weights and citations**, so that the profile reflects the real Rihal JD.
  - Acceptance: each competency row edits name (SHL vocabulary), mapped IPIP
    facets (validated against the 30 facets in the item bank), target band
    (direction + percentile), weight, and source citation. zod rejects an empty
    name, a facet not in the bank, a weight ≤ 0, or a band percentile outside 1–99
    with a boundary message, not a 500.
- **As an HR_ADMIN, I want to approve & activate a profile version**, so that it
  becomes the immutable target the runner/scoring use.
  - Acceptance: approve records `approvedBy` + `approvedAt`, flips status to
    APPROVED→ACTIVE, and locks the version (further edits require a new version).
    Exactly one ACTIVE version per lineage; activating a new one supersedes the old
    (old stays interpretable for historical results).
- **As an HR_ADMIN, I want to clone an approved profile into a new draft version**,
  so that I can revise bands without mutating history (calibration depends on this).
  - Acceptance: "New version" clones competencies/facet-maps/SJTs into a DRAFT with
    `version+1`, same `lineageId`; the approved version is never mutated.
- **As an HR_ADMIN/HIRING_MANAGER, I want to view a role profile and its version
  history**, so that I can see who changed what and the evidence trail.
  - Acceptance: `/app/roles/[id]` shows the active version's competencies + bands +
    facet maps + citations + version timeline. Managers see it read-only; SJT
    scoring keys are masked from non-admins (UI-SPEC D.4).
- **As a HIRING_MANAGER, I must NOT be able to author/approve/delete profiles**, so
  that authoring stays an admin responsibility.
  - Acceptance: all write routes are `withAdminAuth`; a manager session gets 403
    (verified by contract test), and the "New role profile" CTA is not rendered.

## Scenarios (per story)
- **Create/draft — Happy:** admin pastes JD, picks "Sales/BD", clicks Draft → AI
  returns 5 competencies with facets/bands/citations → admin tweaks one weight →
  saves DRAFT. Worst: LLM seam unset → AI control shows "AI drafting unavailable —
  configure the LLM endpoint in settings" and manual authoring proceeds; LLM
  configured but endpoint errors/times out → inline "Drafting failed — retry or
  author manually", responses never lost, no 500.
- **Edit — Happy:** map "Achievement-Striving" facet, set band ≥70th, weight 1.0.
  Worst: facet "telepathy" (not in bank) → zod 422 with field message; weight 0 →
  rejected; band 150 → rejected; concurrent edit of an APPROVED version → 409/blocked
  (immutable).
- **Approve — Happy:** review step shows full summary + citations → "Approve &
  activate" → status ACTIVE, prior ACTIVE archived. Worst: approve a profile with 0
  competencies → blocked with message; manager hits the approve route directly → 403.
- **Clone/version — Happy:** new version off v1 → DRAFT v2, v1 untouched. Worst:
  attempt to edit v1 directly → blocked (clone-to-edit enforced server-side).
- **View — Happy:** admin sees keys; manager sees masked keys. Worst: cross-tenant
  id (`orgId` mismatch) → 404 (not 403, no existence leak), enforced by `findFirst`
  `{ id, orgId }`.

## Architecture sketch
**Entities** (new; all `orgId`-scoped except where noted — follows the existing
`RoleFamily` pattern, SECURITY.md §3 tenancy invariant). None hold Restricted data
(SECURITY.md §1) — JD text is org-internal business data, not PII/secrets.
- `RoleProfile { id, orgId, roleFamilyId, lineageId, version, status, title,
  jdSourceText?, isAiDrafted, createdBy, approvedBy?, approvedAt?, deletedAt,
  deletedBy }` — versioned. `lineageId` groups versions of "the same" profile;
  `version` increments per lineage; `@@unique([orgId, lineageId, version])`.
  status enum `RoleProfileStatus { DRAFT, IN_REVIEW, APPROVED, ACTIVE, ARCHIVED }`.
  Soft-deletable + audited + recycling-bin registered.
- `Competency { id, roleProfileId, name, onetRef?, importance?, weight,
  targetDirection (HIGH|MODERATE|LOW), targetPercentile, sourceCitation, order }` —
  child of a profile version (cascade). Audited.
- `CompetencyFacet { id, competencyId, facet }` — join from competency → IPIP facet
  machine-name (string matching `AssessmentItemBank.facet`). `@@unique([competencyId,
  facet])`. Audited.
- `SjtItem { id, roleProfileId, scenario_en, scenario_ar?, options (Json),
  scoringKey (Json), order }` — child of a profile version (cascade). Audited;
  scoringKey masked from non-admins at the API boundary (not just UI).

**Routes** (method · path · wrapper · service):
- `GET  /api/role-profiles` · `withManagerAuth` → list (orgId-scoped, paginated/bounded)
- `POST /api/role-profiles` · `withAdminAuth` → create DRAFT (zod) → `roleProfileService.create`
- `GET  /api/role-profiles/[id]` · `withManagerAuth` → detail (orgId `findFirst`; keys masked for managers)
- `PUT  /api/role-profiles/[id]` · `withAdminAuth` → edit DRAFT only (409 if not DRAFT/IN_REVIEW)
- `DELETE /api/role-profiles/[id]` · `withAdminAuth` → soft-delete
- `POST /api/role-profiles/[id]/version` · `withAdminAuth` → clone → DRAFT v+1
- `POST /api/role-profiles/[id]/approve` · `withAdminAuth` → APPROVED→ACTIVE, supersede prior, lock
- `POST /api/role-profiles/draft` · `withAdminAuth` + `withRateLimit` (outside) → AI Role 1: calls
  `llm.draftRoleProfile(jd, family)` → returns *unsaved* draft JSON (zod-validated) for the wizard.
  Returns 503 `{ feature: "ai-drafting", configured: false }` when the seam is unset.

**LLM seam** — `lib/llm.ts` (server-only, mirrors `lib/scoring.ts`): env-driven
OpenAI-compatible endpoint (`LLM_ENDPOINT_URL` / `LLM_ENDPOINT_TOKEN` /
`LLM_MODEL`), `isLlmConfigured()`, bounded `AbortSignal.timeout`, `LlmError`, zod
on the response (strict competency-draft schema, ARCHITECTURE §4). Low temperature;
prompt supplies the O\*NET work-styles + Big-Five reference as context and forbids
inventing competencies. **No hardcoded provider; no public API; works unset.**

**Where state lives:** DB (Prisma/Neon). Wizard transient state is client-side
(react-hook-form) until the DRAFT is persisted. No duplication — reuses the existing
`RoleFamily` rows (REPO-MAP), the `AssessmentItemBank.facet` vocabulary as the facet
source of truth, `lib/api-helpers.ts` wrappers, the audit + soft-delete extensions,
and the `AppShell`/`nav.ts` shell. New nav item "Role profiles" (admin-only) added
to `components/layout/nav.ts`.

**Migrations:** one new migration `add_role_profile_authoring` — additive only (new
tables + enum), drops nothing the running version reads (forward-compatible per
vercel.json `migrate deploy` on every build).

**Calibration & audit (introduced-from-day-one rule):** the *audit trail* for
authoring is introduced here and is live from this phase (every create/edit/approve/
version/delete audited; the version timeline IS the authoring audit surface). The
`ProfileCalibration`/`OutcomeRecord` *loop* (ARCHITECTURE §7) attaches to `Result`
rows, which do not exist until Phase 6/7 — so the **versioning substrate it depends
on** (immutable approved versions, lineage) is built now, and the calibration tables
land in Phase 7 where they're introduced. Documented so it isn't mistaken for a gap.

## The five pillars
- **Speed** — list/detail are RSC reads, orgId-indexed, bounded (take/paginate); the
  AI draft call is the only slow path and is explicitly a user-triggered async with a
  drafting state + bounded timeout.
- **Maintainable** — reuses `RoleFamily`, the auth wrappers, both Prisma extensions,
  the validations pattern, the shadcn shell; no new primitives; one service module.
- **Scalable** — `findMany` bounded; competencies/facets/SJTs fetched per-profile
  (no N+1; use `include`); versioning is append-only, not unbounded mutation.
- **Secure** — every write `withAdminAuth`, every route orgId-scoped via `findFirst
  {id,orgId}` (404 on cross-tenant, no existence leak), zod at every boundary, SJT
  scoringKey masked server-side for managers, audit on, LLM token `min(32)`, draft
  route rate-limited. No Restricted columns added.
- **High-Quality** — designed empty/loading/error/AI-failed states (UI-SPEC D.3),
  on-token Rihal styling, RTL + dark, axe-clean, honest feedback (AI failure shows a
  real retry, never a green toast over a failure).

## Open questions (resolved with documented defaults; flagged for operator review at the Phase 3/4 gate)
- [x] **Versioning model?** → `lineageId` + per-lineage `version` int; APPROVED/ACTIVE
  versions are immutable; "New version" clones to a DRAFT. One ACTIVE per lineage.
  (Standard, reversible, matches §5 "never mutate an approved profile.")
- [x] **How much SJT authoring in Phase 3?** → Ship the `SjtItem` *schema* + read/
  display + minimal create/edit so the model + versioning + masking exist from day
  one; the *AI-drafting of SJT scenarios* (UI-SPEC D.3 step 4) is deferred to align
  with Phase 4 (candidate runner) where SJT is consumed. Flagged for operator sign-off.
- [x] **AI drafting when seam unset?** → Feature-detect via `isLlmConfigured()`;
  manual authoring is the always-available path; AI is strictly additive. (Operator
  wires the endpoint from settings later, per their instruction.)
- [x] **Starter profiles?** → Seed the 5 families' starter profiles from ARCHITECTURE
  §5 (Sales/PMO/Support/Legal-GRC/Leadership) as pre-approved ACTIVE v1, grounded +
  cited, idempotent upsert (don't clobber HR edits on re-seed).
