# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-phase-2-scoring-c9m6xr`. Verify pushed: `git rev-list --count @{u}..HEAD` = 0.
**Operator goal:** Build the platform in the 8 phases of ARCHITECTURE.md §12, **pausing for operator review after each phase.** Spec files (ARCHITECTURE.md, UI-SPEC.md) are session UPLOADS, NOT in the repo — re-request them before any phase that needs the detail.

## Status: Phase 3 (role-profile authoring) — BUILT, pushed. ⚠️ FINAL GATES NOT YET RUN (see "MUST DO FIRST").

This session built Phase 3 end-to-end (backend + UI) but hit the context hard
limit (~117%) right after the build went green, BEFORE the formal `/ship`,
`/code-review`, and `senior-code-reviewer` gates could run. Everything is
committed + pushed so nothing is lost; the gates are the first task next session.

### ⚠️ MUST DO FIRST next session (the deferred gates — do NOT skip; do NOT start Phase 4 until green)
1. `npm install` (branch deps), bring up local PG (recipe below), then:
2. **`/code-review`** on the Phase-3 diff (touches schema/lib/API — required pre-push gate).
3. **`/ship`** — must be GREEN. The pre-push BUILD gate passed on push, but the
   full `/ship` (typecheck+lint+contract tests+build+gitleaks+npm-audit) was not
   run as one pass this session. Backend pieces were each verified green
   (tsc clean, eslint clean, 16 new contract tests pass, seed verified); the UI
   was verified to typecheck clean. Run the real gate and fix anything.
4. **`senior-code-reviewer`** (post-push breadth pass) — resolve findings.
5. Then state what's testable + pause for operator review before Phase 4.

### Key standing decisions (DO NOT relitigate)
- UI = **Tailwind v4 + shadcn/ui** (AntD pivoted out in Phase 1).
- Scoring = **deterministic Python service** (`services/scoring`), never the LLM (ADR-029).
- **LLM is a runtime-config seam** (ADR-030): bounded to 2 roles, env-gated, no
  hardcoded provider, works unset. Operator wires the endpoint from settings later.
- Item bank = global reference data (no orgId). Everything else orgId-scoped (SECURITY.md §3).
- RoleProfile versioning: `lineageId` + per-lineage `version`; APPROVED/ACTIVE
  immutable; revise = clone to new DRAFT; exactly one ACTIVE per lineage.

### What Phase 3 shipped
**Blueprint:** `docs/blueprints/phase-3-role-profile-authoring.md` (committed; the contract).

**Schema + migration** `20260627053751_add_role_profile_authoring` (additive):
- `RoleProfile` (orgId, roleFamilyId, lineageId, version, status `RoleProfileStatus`
  DRAFT→IN_REVIEW→APPROVED→ACTIVE→ARCHIVED, title, jdSourceText?, isAiDrafted,
  createdById, approvedById, approvedAt, soft-delete). `Competency`,
  `CompetencyFacet`, `SjtItem`. Enum `BandDirection` HIGH/MODERATE/LOW.
- Registered: `SOFT_DELETE_MODELS` (+RoleProfile) + `RECYCLABLE_ENTITY_TYPES`
  (RoleProfile→title). Audited automatically (not in EXCLUDE).

**Backend:**
- `lib/ipip-facets.ts` — single source of truth for the 30 IPIP facets (grouped by
  domain). Test-locked to the seeded item bank (`tests/contracts/ipip-facets.test.ts`).
- `lib/llm.ts` — AI Role 1 drafting: `isLlmConfigured()`, OpenAI-compatible env
  endpoint (`LLM_ENDPOINT_URL/TOKEN/MODEL` in `lib/env.ts`), bounded timeout,
  `LlmError`, model output validated by `llmDraftResponseSchema` (same competency
  contract as humans). Dormant when unset → 503 → UI manual fallback.
- `lib/validations/roleProfile.ts` — zod (competency/SJT/create/update/draft +
  llmDraftResponse). Facets restricted to IPIP_FACETS; SJT scoringKey must
  reference real option ids.
- `lib/services/roleProfile.ts` — list/get/create/update/clone-version/approve/
  listVersions + `maskScoringKeys` (SJT keys masked for non-admins SERVER-side).
  AUDIT DESIGN: profile-level ops auto-audited; children written as atomic nested
  relation writes; immutable versions preserve content history. (Worth a senior-
  review look: per-child audit granularity is at the aggregate/version level.)
- API routes `app/api/role-profiles/*`: `GET/POST /`, `GET/PUT/DELETE /[id]`,
  `POST /[id]/version`, `POST /[id]/approve`, `POST /draft` (rate-limited). Writes
  `withAdminAuth`; reads `withManagerAuth`; all orgId-scoped (404 cross-tenant);
  edit blocked (409) on locked versions; approve needs ≥1 competency.
- `prisma/seed.ts` + `prisma/data/starter-role-profiles.ts` — 5 grounded+cited
  starter profiles, idempotent (stable lineageId `starter:<key>`, create-once,
  never clobbers HR edits). Verified: 22 competencies, 26 facet maps, 0 facets
  outside the IPIP bank.
- ADR-030, SECURITY.md §6 (LLM tokens), `.env.example` LLM block.

**UI (built by subagent against the locked API — REVIEW IT in /code-review):**
- `components/layout/nav.ts` — "Role profiles" nav item (admin).
- `app/[locale]/app/roles/page.tsx` (list, RSC), `roles/new/` (5-step AI-assisted
  wizard, client), `roles/[id]/` (detail + version history), plus `FacetPicker.tsx`,
  `RoleProfileWizard.tsx`, `StatusBadge.tsx`. New shadcn primitives:
  `components/ui/{select,table,textarea}.tsx`. i18n keys added to `messages/en.json`
  + `messages/ar.json`. AI-unconfigured path falls back to manual authoring.
  ⚠️ The UI was NOT design-QA'd or manually exercised this session — do `/design-qa`
  + a manual click-through (local run) as part of the gates.

### Local run recipe (proven; run `npm install` after branch FF)
- PG16 at `/usr/lib/postgresql/16/bin`: `mkdir -p /tmp/pg3/data && chown -R
  postgres:postgres /tmp/pg3` → `runuser -u postgres -- $PGBIN/initdb -D
  /tmp/pg3/data -U postgres --auth=trust` → `pg_ctl -D /tmp/pg3/data -o "-p 5433 -k
  /tmp/pg3" -w start` → `createdb -p 5433 -h /tmp/pg3 appdb`. (rm -rf deny-listed —
  use a fresh dir name; docker daemon is down, use PG-direct.)
- `DATABASE_URL="postgresql://postgres@localhost:5433/appdb?schema=public"`
  `npx prisma migrate deploy` + `SEED_ADMIN_EMAIL=hr@rihal.test
  SEED_ADMIN_PASSWORD='Passw0rd!demo' npm run prisma:seed`.
- `/ship` needs DATABASE_URL + AUTH_SECRET(32+) + AUTH_URL.
- Optional: test AI drafting by setting LLM_ENDPOINT_URL to a mock; it's dormant otherwise.

### NEXT: Phase 4 — Candidate runner (ARCHITECTURE §12.4, UI-SPEC C.1–C.5)
Bilingual/RTL token-link runner: consent (PDPL), 120 IPIP items paged+autosave,
SJT scenarios, completion. A scoring API route (persist responses → `requestScoring`
→ store Result) also lands here (needs Assessment/Response/Result models — new
schema). Re-request the spec uploads first. Pause for operator review after.

### Watch-outs
- Spec files are session uploads, NOT in repo.
- Don't push `--no-verify`; the pre-push hook runs the build (it gated this push).
- Next dev shows a dev-tools overlay circle bottom-left (not a UI bug).
