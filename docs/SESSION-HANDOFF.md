# Session handoff — Rihal Aptitude Platform

**Goal:** build ARCHITECTURE.md §12's 8 phases (specs = session UPLOADS
ARCHITECTURE.md + UI-SPEC.md, NOT in the repo — re-request before detail work).
**Sub-goal now:** ALL 8 PHASES DONE + deployed; what's left is the deferred
full a11y/RBAC QA matrix.

**State:** branch `claude/rihal-phases-7-8-qa-so8cim` — **fast-forwarded from
`…-b2zaau`** (so8cim was a strict ancestor: the FF brought all 8 phases + deploy
onto this branch non-destructively) and then carries the QA-matrix commit on top.
**LIVE in production:** https://rihal-aptitude.ops-rihal.com — Vercel deploy
`dpl_6hUtoGk6he8FZbpwN74mfQdNwtTD` READY (`prisma migrate deploy` applied the Phase
7/8 migrations to Neon prod). Project `prj_jKdcMNnuGdkAlAyZXBKcPaGK8YJu`, team
`team_Buc334YaFWzCtASZs9oWvcI5`, repoId `1241728413`.

## Done this session — deferred QA matrix CLOSED (newest first)
- **QA matrix GREEN (52/52, `npm run uat:full`).** Authored/restored the FULL-mode
  specs the Rihal branch had dropped + fixed 3 inherited harness portability bugs.
  Full write-up: `docs/qa-phase-7-8-matrix.md`; register: `docs/findings-register.md`
  (Resolved 2026-06-28). a11y axe (8 dash + login + methodology), RBAC matrix
  (HR_ADMIN×HIRING_MANAGER×8, server-gate-derived), invitation CRUD lifecycle,
  UI/UX+RTL sweep + nav-vs-server check. Local-PG carbon-copy recipe in agent-memory.

## Prior session — 8 phases + deploy (newest first)
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
1. **Confirm prod is healthy** from a direct-egress machine: load
   https://rihal-aptitude.ops-rihal.com, check nav (Calibration/Settings/Audit) +
   auth. The build container is proxy-blocked (403) from the live host, so this
   session could NOT independently re-verify prod (deploy was READY per prior session).
2. **Operator follow-ups** (documented scope, `docs/findings-register.md` 2026-06-28):
   (a) re-verify prod; (b) optionally add candidate-runner `/a/[token]` to the
   automated axe gate (mint a token fixture) — runner already passed a MANUAL axe
   pass in Phase 4; (c) AI-wizard role CRUD stays unautomated until the LLM endpoint
   is configured.
3. Decide whether to FF this branch → `main` (so8cim now = b2zaau + QA matrix).

Process for any new code: `/code-review` (high) → `/ship` GREEN → push to
`…-so8cim` → `senior-code-reviewer`. Commit + push before the session ends.
