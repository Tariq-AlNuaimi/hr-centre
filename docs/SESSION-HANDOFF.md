# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-phase-4-candidate-runner-3r3ix6` (tip pushed; `git rev-list --count @{u}..HEAD` = 0).
**Operator goal:** Build the platform in ARCHITECTURE.md §12's 8 phases, **pausing for operator review after each phase.** Specs (ARCHITECTURE.md, UI-SPEC.md) are session UPLOADS, NOT in the repo — re-request before any phase needing detail.

## Status: Phase 3 gates DONE. Phase 4 BUILT + ship-green + pushed; Phase-4 QA gates NOT yet run.
This session: (1) ran the deferred Phase-3 gates and resolved findings, (2) built Phase 4 (candidate runner) backend + UI. Hit the context limit (~169%) right after the UI shipped green — so the Phase-4 **browser UAT / design-QA / senior-code-reviewer** did NOT run. Everything is committed + pushed (nothing lost). **Those three gates are the first task next session, then pause for operator review before Phase 5.**

### ⚠️ MUST DO FIRST next session (Phase-4 gates — do NOT skip; do NOT start Phase 5 until done)
1. `npm install` (after any FF), bring up local PG + seed (recipe below), start dev **with DATABASE_URL** (see the gotcha below — the runner 500s without it).
2. **Browser UAT of the runner** (`/a/<token>`): full happy path consent → 120 items (paged, autosave, resume) → SJT → completion; worst paths (invalid/expired/revoked/completed token states; out-of-range value → 422; post-submit write → 409; save-failure inline retry). Use the test token below or mint a fresh one.
3. **/design-qa on `/a/*`**: axe AA, EN + **AR full RTL**, mobile @360px, dark mode, reduced-motion, journey line, 44px targets. The runner was built to-spec but NOT yet visually verified or axe-tested.
4. **senior-code-reviewer** on the Phase-4 diff (range `9fa5210..HEAD`, i.e. the 4 Phase-4 commits) — resolve findings, /ship green.
5. State what's testable + **pause for operator review before Phase 5.**

### What Phase 4 shipped (committed + pushed, /ship green)
**Blueprint:** `docs/blueprints/phase-4-candidate-runner.md` (the contract).
**Schema** (migration `20260627070402_add_candidate_runner`, additive): `Invitation` (minimal — token entry + candidate PII; full invite UI is Phase 5), `Assessment`, `ItemResponse` `@@unique([assessmentId,itemNumber])`, `SjtResponse` `@@unique([assessmentId,sjtItemId])`. Enums `InvitationStatus`/`AssessmentStatus`. Soft-delete + recycling-bin: `Invitation`+`Assessment` (PDPL erasure; responses cascade on permanent delete). **All four audited** (per blueprint "audit ON for all" — see the trade-off note below). `candidateEmail`/`candidateName` + behavioral responses + `scoringKey` classified **Confidential** in SECURITY.md §1 (PDPL).
**Auth + API:** `withCandidateToken` (lib/api-helpers.ts) — opaque high-entropy token authorizes (NOT a client id), uniform invalid/revoked/expired states (no enumeration), orgId stamped + **NULL user**, rate-limit OUTSIDE. `lib/services/candidateRunner.ts` — token resolution, **bilingual** item/SJT render with `scoringKey` NEVER selected, idempotent autosave via find-then-create/update (audited; no upsert → no `no-unaudited-bulk-write` trip; P2002 race → update), consent/submit lifecycle, `getInvitationDisplay` (read-only). Routes `app/api/run/[token]/{consent,response,submit}` — zod on every body; SJT option verified server-side; writes rejected once SUBMITTED. Public via middleware `/api/run` allow-list + `/a/*` non-localized passthrough. Contract test `tests/contracts/candidate-validation.test.ts`.
**UI:** `app/a/layout.tsx` (own `<html>` outside `[locale]`; fonts + globals + ThemeProvider; NO next-intl). `app/a/[token]/{page.tsx (RSC),Runner,ConsentStep,ItemsStep,SjtStep,CompletionStep,JourneyLine,SaveIndicator,TokenStateScreen,save.ts}` + `lib/candidate-i18n.ts` (typed EN/AR dict). Consent (PDPL + /methodology link, Begin gated on checkbox → POST before any write), 120 items 5/screen native-radio Likert (44px, fieldset/legend), one-scenario SJT, completion (submit once, no score), journey line (reduced-motion safe), optimistic autosave + inline retry, resume-to-first-unanswered, EN/AR in-place toggle + full RTL via logical utilities + `dir`.

### Phase-3 gates resolved this session (commits b229971, e761d3f — pushed)
/code-review + senior-code-reviewer + /design-qa on `/app/roles/*`. Fixed: unbounded findMany bounds (Pillar 4); StatusBadge + nav AA-contrast (added `--signal-*-ink` text tokens); `updateRoleProfile` service-layer orgId guard; `scoringKey` → SCRUB_FIELDS + export denylist + SECURITY.md; create/version routes mask SJT keys; LLM token floor on the draft path; `RoleFamily` recyclable; jdSourceText injection documented. Accepted design calls in `docs/findings-register.md`.

### Test setup (proven this session)
- A test invitation was created this session against the Support starter profile (120 items + 1 SJT, locale en). The token literal is intentionally NOT recorded here (gitleaks flags high-entropy strings, and it's a throwaway local-DB artifact). **Mint a fresh one**: `prisma.invitation.create` (or `update` an existing) against an ACTIVE profile with `token: randomBytes(32).toString("base64url")`, then open `/a/<that-token>`.
- Starter profiles have **0 SJT items**; this session added 1 SJT to the Support profile for testing (only in the local DB, not seeded). Add SJTs per profile to exercise the SJT step, OR the runner correctly SKIPS the SJT step when empty.

### Local run recipe (proven; `npm install` after branch FF, then `npx prisma generate` with DATABASE_URL set)
- PG16 at `/usr/lib/postgresql/16/bin`, run as the `postgres` system user (PG refuses root): `mkdir -p /tmp/pg4/data && chown -R postgres:postgres /tmp/pg4` → `runuser -u postgres -- $PGBIN/initdb -D /tmp/pg4/data -U postgres --auth=trust` → `cd /tmp && runuser -u postgres -- $PGBIN/pg_ctl -D /tmp/pg4/data -o "-p 5433 -k /tmp/pg4" -w start` → `runuser -u postgres -- $PGBIN/createdb -p 5433 -h /tmp/pg4 appdb`. (`rm -rf` is deny-listed — use a fresh dir name; docker is down.)
- `export DATABASE_URL="postgresql://postgres@localhost:5433/appdb?schema=public"` then `npx prisma migrate deploy` + `SEED_ADMIN_EMAIL=hr@rihal.test SEED_ADMIN_PASSWORD='Passw0rd!demo' npm run prisma:seed`.
- **Start dev WITH the env**: `DATABASE_URL=… AUTH_TRUST_HOST=true AUTH_URL=http://localhost:3000 AUTH_SECRET=<from .env> npm run dev`. ⚠️ **GOTCHA: if the dev server is started WITHOUT DATABASE_URL, `/a/*` 500s** inside `resolveToken` (DB call) — that's a dev-env issue, not a UI bug. Admin login + `/app/roles` worked authenticated this session.
- Browser QA: drive via the Playwright test runner with `chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" })` (the bundled @playwright/test version mismatches the default browser path) + `@axe-core/playwright`. Put the script INSIDE the repo (ESM needs node_modules resolution) and clean it up. Login form: `#email`/`#password`/`button[type=submit]`; post-login lands at `/en/app` (NOT `/en/`).
- `/ship` heals stale `.next` only via its build (phase B) — but typecheck (phase A) runs FIRST, so on a stale cache after adding a route it FAILS on `.next/dev/types`. Fix: run `npx next build` once (regenerates `.next/types`), THEN `npm run ship`. (`rm -rf .next` is denied.)

### Open decisions for OPERATOR review (flagged, not silently shipped — see docs/findings-register.md)
- **Audit ON for candidate responses** (per blueprint literal): every IPIP/SJT answer write is audited (null actor). Faithful to the blueprint but floods the audit surface with ~120 null-actor rows per candidate. If undesired, an ADR can move `ItemResponse`/`SjtResponse` to the audit EXCLUDE set (Ask-before) and switch autosave to upsert. **Operator: keep audited, or exclude?**
- One-ACTIVE-per-lineage is app-enforced (no DB partial unique index — Prisma can't express it without migrate drift); Phase 4+ resolves the active profile deterministically. Accepted.
- `RoleProfileStatus.APPROVED` is currently unreachable ("Approve & activate" is one action). Retained for a possible future two-approver workflow.

### Watch-outs
- Specs are session uploads, NOT in repo.
- The candidate runner is the first **public, unauthenticated** surface — treat the token routes + page as the highest-risk review target in the senior pass.
- Result/scoring roll-up is **Phase 6** (Phase 4 stops at captured responses + submit).
