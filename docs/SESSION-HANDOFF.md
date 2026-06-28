# Session handoff — Rihal Aptitude Platform

**Goal:** build ARCHITECTURE.md §12's 8 phases (specs = session UPLOADS
ARCHITECTURE.md + UI-SPEC.md, NOT in the repo — re-request before detail work).
**Sub-goal now:** ALL 8 PHASES DONE + deployed; what's left is the deferred
full a11y/RBAC QA matrix.

**State:** branch `claude/rihal-phase-5-invitations-b2zaau`, tip `~a9f…` (push
verified, `git rev-list --count @{u}..HEAD` = 0), tree CLEAN. `/ship` GREEN
(typecheck+lint+182 tests+build+gitleaks+audit). **LIVE in production:**
https://rihal-aptitude.ops-rihal.com — Vercel deploy `dpl_6hUtoGk6he8FZbpwN74mfQdNwtTD`
state READY (built from the branch tip; `prisma migrate deploy` applied the Phase
7/8 migrations to the Neon prod DB). Project `prj_jKdcMNnuGdkAlAyZXBKcPaGK8YJu`,
team `team_Buc334YaFWzCtASZs9oWvcI5`, repoId `1241728413`.

## Done this session (newest first)
- All 8 ARCHITECTURE phases complete. This session landed Phases 7 + 8 + final QA:
- `fix(phase-8)` — senior-review fixes: SSRF metadata-block on admin-settable AI URLs;
  PDPL erasure now also soft-deletes OutcomeRecord; dead `safeEqual` removed; UAT
  harness wired for this fork (`auth.setup` regex + `_discover` glob → `/<locale>/app`).
- `feat(phase-8a/b/c)` — editable AI/scoring config (ADR-031: AES-256-GCM token at
  rest, DB-then-env, write-only/masked); settings (org/users/PDPL-erasure); `/app/audit`
  table + Excel export. `/methodology` was already complete (left as-is).
- `feat(phase-7)` (+follow-up) — calibration loop: OutcomeRecord+ProfileCalibration,
  pure `lib/calibration.ts` (16 tests), routes, `/app/calibration` UI (capture, scatter,
  advisory report, adverse-impact monitor). ADVISORY only — never auto-adjusts a band.
- `fix(phase-6)` — applied the Phase-6 UI senior-review findings + their follow-ups.

## In flight
- None. Tree clean, all pushed, deploy READY.

## Decisions (don't relitigate)
- shadcn/Tailwind v4 (NOT AntD); deterministic Python scoring svc; LLM = config-gated
  seam, now EDITABLE in Settings (ADR-031, encrypted token, supersedes ADR-030);
  tenant by orgId; role profiles versioned/immutable-when-approved; calibration
  ADVISORY only; audit ON. `SCORING_SERVICE_URL`/`LLM_*` UNSET in prod → honest "not
  configured"/"insufficient" states (set them in-app via Settings now, no redeploy).

## Landmines
- **Branch trap:** `…-fqv38u`/`…-cw04v6`/`…-l2z01b` are bare-template decoys (zero
  Rihal code). Real work = `…-b2zaau`. Verify schema has RoleProfile/Assessment/
  Result/OutcomeRecord/ProfileCalibration/AppSetting before building.
- Prisma 7 client goes stale across branch moves → `npm install` + `DATABASE_URL=… AUTH_SECRET=<32+> npx prisma generate` before typecheck.
- Browser QA is LOCAL-ONLY (live host is proxy-blocked 403). Local-PG-as-root recipe
  + the `executablePath` chromium pin are in `docs/agent-memory.md` (2026-06-27).
- `"use client"` must not import a runtime value from a Prisma-importing module
  (settings/audit/user services) — use `import type` or a client-safe const file.

## Next steps
1. **Confirm prod is healthy:** load https://rihal-aptitude.ops-rihal.com, check the
   new nav (Calibration/Settings/Audit Log) renders + auth works.
2. **Finish the deferred QA matrix** (honest gaps): automated **axe a11y** (this branch
   has no a11y UAT project — wire `@axe-core/playwright` into a `*.uat.ts` or use
   `/design-qa`), **full** `/uat` permission-matrix + CRUD journeys, `/manual-uat`
   per-role RBAC. Use the local-PG recipe + `npm run uat`. (Already verified: lean UAT
   green on all 11 screens; recharts radar/bars correct in dark + RTL.)
3. Optional: with the operator, decide whether to FF this branch → `main`.

Process for any new code: `/code-review` (high) → `/ship` GREEN → push to the b2zaau
branch → `senior-code-reviewer`. Commit + push before the session ends.
