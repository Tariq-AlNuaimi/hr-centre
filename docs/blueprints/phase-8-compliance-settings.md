# Blueprint — Phase 8: Compliance + Editable Settings

> ARCHITECTURE.md §11 (PDPL/ISO audit posture), §13 (limitations); UI-SPEC.md D.10
> (settings + audit), D.11 (methodology). Builds on Phase 1–7. Supersedes ADR-030's
> read-only AI-config stance via **ADR-031** (editable AI/scoring config).

## Problem & outcome
The platform is functionally complete (Phases 1–7) but its **compliance + admin
surface is stubbed**: `/app/settings`, `/app/audit`, and `/methodology` are
placeholders, and the AI/scoring endpoints can only be set via platform env vars.
Phase 8 makes the platform **operable + auditable by a non-developer HR_ADMIN** and
**defensible to an auditor**:
- HR_ADMIN configures AI/scoring endpoints in Settings (ADR-031), manages users,
  sets data-retention + default language + branding, and runs PDPL candidate erasure.
- `/app/audit` is the ISO/PDPL evidence surface: a filterable, exportable table over
  `AuditLog`.
- `/methodology` is the full public standards page an auditor or challenged candidate
  is shown (the defensibility document, ARCHITECTURE §2/§13).

## Market scan
- **Editable secrets in app settings:** every SaaS admin console (Vault, Doppler,
  platform "integrations" tabs) stores provider tokens encrypted with a write-only/
  masked field. We adopt that pattern with `node:crypto` AES-256-GCM (no new dep) —
  a KMS is overkill for the prototype rail and re-introducible at handoff (ADR-031).
- **Audit-log UI:** the shipped shadcn `Table` + the existing `app/api/audit-log`
  read route + `lib/export.ts` (Excel) — no TanStack/log-viewer dep; our volumes are
  bounded + server-paginated.
- **Methodology page:** static content (the O*NET→Big Five→IPIP→bands→fit chain +
  Johnson-norm provenance + AERA/APA/NCME + SIOP + honest limitations) — pure prose,
  no library.

## Tier
`personal` (per `project.config.json`). Touches the Ask-before surface heavily
(Prisma migration, new API routes, `lib/llm.ts`/`lib/scoring.ts`, new crypto in
`lib/`, `SCRUB_FIELDS`), so the full track + this blueprint are correct regardless.
Security floor unchanged + reinforced (the encrypted-token contract).

## User stories
- **As an HR_ADMIN, I want to set the AI/scoring endpoints + tokens in Settings**, so
  that I can wire the platform without a redeploy.
  - Acceptance: a Settings form sets LLM URL/model/token + scoring URL/token; the
    token is write-only (never shown back, shown as "set"/"not set" + masked); reads
    use DB-then-env; the token is encrypted at rest + scrubbed from audit; env stays
    a fallback. (ADR-031.)
- **As an HR_ADMIN, I want to manage users + org settings**, so that the org is
  self-administered.
  - Acceptance: list/create/edit/deactivate users (HR_ADMIN | HIRING_MANAGER) via the
    existing `/api/users` routes; set org name, default language, data-retention days,
    branding (within token bounds).
- **As an HR_ADMIN, I want a PDPL candidate-erasure tool**, so that I can honor a
  right-to-erasure request.
  - Acceptance: find a candidate by email and soft-delete their sitting (cascades to
    responses + result via the recycling bin), audited; the existing purge cron then
    hard-deletes after the retention window.
- **As an HR_ADMIN/auditor, I want a filterable, exportable audit log**, so that I
  have the ISO/PDPL evidence surface.
  - Acceptance: `/app/audit` lists `AuditLog` (actor/action/entity/timestamp) with
    filters (action, entity type, actor) + Excel export; paginated; Restricted values
    already scrubbed at write time.
- **As an auditor or challenged candidate, I want the methodology page**, so that the
  assessment basis is transparent.
  - Acceptance: `/methodology` documents the standards chain, the Johnson-norm
    provenance/limits, AERA/APA/NCME + SIOP, and the honest limitations (§13).

## Scenarios (per story)
- **AI config — Happy:** set LLM URL + token → saved; the result/draft paths now use
  it (DB-then-env); token never returned.
- **AI config — Worst:** token < 32 chars / malformed URL → zod 422; GET settings →
  the token field is masked, never plaintext; a forged/garbled ciphertext →
  `decryptSecret` returns null → treated as "not configured", no crash; audit row for
  the write shows `valueEncrypted: [redacted]`.
- **User mgmt — Worst:** create a user with a duplicate email → 409; a HIRING_MANAGER
  hitting an admin settings route → 403; an admin can't delete themselves into an
  org with zero admins (guard) → 422.
- **Erasure — Worst:** erase by an email with no sitting → not-found (no-op message);
  erasure is audited; a manager (non-admin) → 403.
- **Audit export — Worst:** empty/filtered-to-nothing → an empty branded sheet, not a
  crash; a Restricted field is `[redacted]` in the export (scrubbed at source).

## Architecture sketch
**Entities:**
- `AppSetting { id, orgId, key, value String?, valueEncrypted String?, updatedById,
  @@unique([orgId, key]) }` (ADR-031). `valueEncrypted` → `SCRUB_FIELDS` + the
  audit-scrub test, SAME commit. Migration `20260627150000_add_app_settings`
  (forward-only; sorts after Phase 7's `..140000`).

**lib:**
- `lib/crypto.ts` (NEW): `encryptSecret`/`decryptSecret` — AES-256-GCM, HKDF(AUTH_SECRET).
- `lib/settings.ts` (NEW): `getAppSetting`/`setAppSetting`/`deleteAppSetting`,
  `resolveLlmConfig(orgId)`/`resolveScoringConfig(orgId)` (DB-then-env),
  `isLlmConfiguredFor`/`isScoringConfiguredFor`, the masked-read DTO.
- `lib/llm.ts` + `lib/scoring.ts` (MODIFY, ADR-031): accept an injected resolved
  `config`; env read stays the fallback. (Ask-before files but operator-mandated.)
- `lib/services/result.ts` (MODIFY): resolve config with `orgId`, pass to
  requestScoring/draftResultNarrative; gate on the async `*ConfiguredFor`.
- `lib/services/user.ts` (REUSE existing `/api/users` routes; add an admin-count guard
  if not present).
- `lib/services/audit.ts` (NEW or reuse `/api/audit-log` read): orgId-scoped,
  paginated audit list + Excel export columns.
- `lib/services/erasure.ts` (NEW): find sitting by candidate email → soft-delete
  (reuse the recycling-bin soft-delete; cascades to result/responses), audited.

**Routes (zod, withRateLimit OUTSIDE, orgId-scoped):**
- `PUT /api/settings/ai` — `withAdminAuth` (set LLM/scoring config).
- `PUT /api/settings/org` — `withAdminAuth` (name/language/retention/branding).
- `POST /api/settings/erase-candidate` — `withAdminAuth` (PDPL erasure by email).
- Users: existing `/api/users` + `/api/users/[id]` (REUSE).
- Audit list + export: existing `/api/audit-log` (REUSE) + an export variant.

**UI (replace stubs; shadcn, en+ar/RTL, on-token, axe-clean):**
- `/app/settings`: sections — AI/scoring config (masked token), org profile, users,
  retention, PDPL erasure, branding, language.
- `/app/audit`: filterable paginated table + export.
- `/methodology`: full static standards page (replaces the Phase-6 stub).

**No-duplication:** users reuse `/api/users`; erasure reuses the recycling-bin
soft-delete (`lib/prisma/recyclable.ts` + the purge cron) — no second deletion path;
audit reuses `/api/audit-log` + `lib/export.ts`. `docs/REPO-MAP.md` confirms settings/
audit/methodology are stubs, not existing implementations.

## The five pillars
- **Speed:** settings/audit reads are RSC + paginated; the config read is one indexed
  `app_settings` lookup, not hot-looped.
- **Maintainable:** reuses `/api/users`, the recycling bin, `lib/export.ts`, the
  shadcn primitives; crypto + settings centralized in one file each.
- **Scalable:** audit list paginated/bounded; export bounded by filter; no full-table
  unbounded scan.
- **Secure:** the encrypted-token contract (ADR-031) — write-only/masked, scrubbed,
  env fallback; every route `withAdminAuth` + zod + orgId; audit ON.
- **High-Quality:** honest states (token "set/not set", erasure "no sitting found",
  empty audit export); the methodology page is the defensibility artifact, not filler.

## Open questions (RESOLVED — defaults per spec/ADR-031; flagged for review at gate-green)
- [x] **Secret storage** → app-layer AES-256-GCM, key = HKDF(AUTH_SECRET) (ADR-031).
  No new env var; rotating AUTH_SECRET re-enters tokens (documented).
- [x] **Config scope** → per-org `AppSetting` (matches the multi-tenant schema); the
  result service already has `orgId`. Env var remains the platform fallback.
- [x] **Branding scope** → within token bounds only (app name + accent within the
  palette), per UI-SPEC A.2 / the `no-raw-hex-color` rule — no arbitrary CSS.
- [x] **Erasure mechanism** → reuse the recycling-bin soft-delete + purge cron (no new
  hard-delete path); the soft-delete cascades the sitting → responses → result.
- [x] **Build order** → 8a AI-config core (ADR + model + crypto + settings + llm/scoring
  + UI section) shipped first (security-critical), then 8b rest-of-settings, 8c audit
  table, 8d methodology + erasure. Each ships green + pushed.
