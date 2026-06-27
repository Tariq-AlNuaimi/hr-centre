# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-phase-5-invitations-b2zaau` (push verified; tip `9d32f2a`,
`git rev-list --count @{u}..HEAD` = 0). **Operator goal:** build ARCHITECTURE.md
§12's 8 phases, **pausing for operator review after each phase.** Specs
(ARCHITECTURE.md, UI-SPEC.md) are session UPLOADS, NOT in the repo — re-request
before any phase needing detail.

## Status: Phases 1–5 DONE. Phase-5 senior-review findings + Resend transport DONE & pushed. Phase 6 BLUEPRINTED, ⏸ awaiting operator sign-off before the build.

### ⚠️ Branch trap (read first)
This session was started on `claude/rihal-phase-5-invitations-FQV38U`, which is a
MISLABELED bare-template/QA branch (zero Rihal code). The REAL work is on
`...-b2zaau` (this branch). If a future session lands on the wrong slug again,
`git log --all --oneline | grep -i phase` finds the true tip; checkout/track
`origin/claude/rihal-phase-5-invitations-b2zaau`. (Also in agent-memory.)

### Done this session
1. **Applied the 4 Phase-5 senior-review findings** (commit `5d332de`):
   - TOKEN_HMAC_KEY added to SECURITY.md §6 table + rotation warning.
   - `resendInvitation` (lib/services/invitation.ts): pre-checks the transport
     (no token rotation when delivery is impossible → **503**), snapshots prior
     token state and **reverts on a failed send** (guarded; **502** on failure),
     so a failed send never strands the candidate (dead old link + undelivered
     new). Threads the acting admin's id into `sentById` (route→service).
   - Removed dead `tokenHashEquals` from lib/token.ts (left a reintroduction note).
2. **Wired Resend as a preferred email transport** (operator-approved Ask-before
   on lib/email.ts; commit `5d332de`): added the `resend` dep; `selectTransport()`
   prefers Resend (`RESEND_API_KEY`) over SMTP, else the `{sent:false}` no-op.
   Metadata-only logging preserved. `RESEND_API_KEY` in lib/env.ts (validates
   `re_` prefix), .env.example, SECURITY.md §1+§6 (Restricted). Contract test
   asserts transport-selection precedence (tests/contracts/email.test.ts).
3. **Senior-code-reviewer (post-push) = "structurally sound"** (no HIGH). Folded
   its cheap findings into `caf3c88`: bound/char-filter Resend `error.name` before
   logging (never `error.message`); treat `{data:null,error:null}` as non-delivery;
   warn when Resend is on but no verified-domain From; documented the intentional
   two-audit-row trail on a failed resend.
4. **Phase 6 blueprint** committed (`9d32f2a`): `docs/blueprints/phase-6-results.md`.

`/code-review` (high) + `/ship` GREEN before every push; all 3 commits pushed (0 unpushed).

### ⏭ NEXT SESSION — do this first
**Get operator sign-off on `docs/blueprints/phase-6-results.md`, THEN build Full
Phase 6.** AskUserQuestion is flaky in this env (failed twice this session) — pose
the sign-off as PLAIN TEXT, don't retry the tool. Operator already chose (via a
working AskUserQuestion round): **@react-pdf/renderer** for PDF, **Full Phase 6**
scope, **lazy-compute-on-view + persist** a Result row. Pause for operator review
when Phase 6 is **gate-green, before Phase 7.**

### Phase 6 build order (per the blueprint)
1. **Migration** `add_result_and_decision`: `Result` model (1/assessment; JSON
   facet/domain/sjt/competency blobs, `fitScore`, `communityPercentile`, cached
   `narrative`+model+at, decision fields `decision`/`decisionNote`/`decidedById`/
   `decidedAt`, `roleProfileVersion` snapshot, soft-delete) + `DecisionOutcome`
   enum (ADVANCE|HOLD|DECLINE). Result is **Confidential** (no new Restricted field
   → no SCRUB_FIELDS change; add a §1 row). Forward-only (adds table+enum). Phase-7
   calibration tables (OutcomeRecord/ProfileCalibration) are OUT of scope.
2. **`lib/scoring-rollup.ts`** — PURE, unit-tested (tests/contracts/scoring-rollup
   .test.ts): SJT scoring (compare `SjtResponse.chosenOptionId` vs `SjtItem.scoringKey`
   server-side, never leak the key), `facetContribution(p,direction)` (HIGH→p,
   LOW→100−p, MODERATE→max(0,100−2·|p−target|)), competency = weighted mean of
   facet contributions ± SJT, band PASS≥target / PARTIAL≥target−15 / BELOW, fit =
   weighted mean of competency scores. **Inspect `SjtItem.scoringKey` + `options`
   JSON shape and `lib/scoring.ts` ScoreResponse before coding the roll-up.**
3. **`lib/services/result.ts`** — orchestrate: load assessment+responses+ACTIVE
   profile → `requestScoring()` (Python svc) → roll up → persist Result (create;
   on unique race re-read). Gated by `isScoringConfigured()`; typed "not
   configured/unreachable" result otherwise (NO partial write).
4. **AI Role 2** `lib/llm.draftResultNarrative` — mirror `draftRoleProfile`;
   numbers-only input (NO JD, NO name/email), schema-validated `{narrative}`, low
   temp, forbid hire/no-hire; dormant+graceful when `!isLlmConfigured()`.
5. **Routes** (withManagerAuth + orgId + withRateLimit OUTSIDE): `POST
   /api/results/[assessmentId]/compute`, `POST /api/results/[id]/narrative`, `POST
   /api/results/[id]/decision` (zod), `GET /api/results/[id]/pdf`. Reads = RSC via
   services, SJT keys masked.
6. **UI** (shadcn + recharts; on-token, EN+AR/RTL, dark, axe-clean — use
   /design-system): wire the dashboard tiles/tables to real counts
   (`app/[locale]/app/page.tsx`, currently hard-coded 0s); `candidates` list +
   `candidates/[id]` evidence-trail page (fit ring, radar, competency breakdown +
   citations, Big-Five bars, SJT, labelled AI narrative, decision block, Export
   PDF) — both currently `<Placeholder>`; `compare` grid (single role, cap 6).
   i18n `results`+`candidates` namespaces. Add a minimal `/methodology` stub so
   the result link isn't dead (full page = Phase 8).
7. **PDF** `lib/pdf/` — `@react-pdf/renderer` branded result template (methodology
   footer + provenance).

### KNOWN CONSTRAINT for Phase-6 QA
The scoring microservice (`SCORING_SERVICE_URL`) and LLM (`LLM_ENDPOINT_URL`) are
**NOT reachable in this container** — live end-to-end scoring/narrative can't be
QA'd here. Plan: full unit-test coverage on the pure roll-up; seams degrade to
honest "not configured" states; **seed a sample COMPLETED assessment** (admin +
an ACTIVE role profile with competencies + 120 ItemResponses + SjtResponses) to
exercise the candidates/result/compare UI paths against the "not configured"
branch. Real scoring needs the Python svc up (services/scoring) — try running it
locally if Python deps install; otherwise note it for the deployed env.

### Local run recipe (proven; PG16 :5433)
- `mkdir -p /tmp/pg5/data && chown -R postgres:postgres /tmp/pg5` → `runuser -u
  postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/pg5/data -U postgres
  --auth=trust` → `cd /tmp && runuser -u postgres -- $PGBIN/pg_ctl -D /tmp/pg5/data
  -o "-p 5433 -k /tmp/pg5" -w start` (`-w` blocks the tool ~2min; cluster still
  starts — verify `pg_ctl status`, then `createdb -p 5433 -h /tmp/pg5 appdb`).
- `export DATABASE_URL="postgresql://postgres@localhost:5433/appdb?schema=public"`
  → `npx prisma migrate deploy` + `SEED_ADMIN_EMAIL=hr@rihal.test
  SEED_ADMIN_PASSWORD='Passw0rd!demo' npm run prisma:seed`.
- **Prisma generate needs envs:** `DATABASE_URL=... AUTH_SECRET=<32+ chars> npx
  prisma generate` (Prisma 7 config resolves env at generate time).
- **STALE-DEPS / STALE-CLIENT GOTCHA:** after a branch/schema move, run `npm
  install` AND `npx prisma generate` before typecheck — else tsc reports phantom
  missing modules / missing enum members (InvitationStatus etc.). Cost real time
  twice now.
- `/ship` build needs no live DB (proven: build passes with DATABASE_URL set but
  unreachable). Drive browser QA via `npm run uat` (Playwright runner), NOT the
  MCP. Container restarts mid-task kill bg servers (DB data under /tmp survives —
  just re-`pg_ctl start`); they also re-trigger SessionStart deps install.

### Client/server boundary (build-only trap)
A `"use client"` component must NOT import a RUNTIME value from
`@/generated/prisma/client` (e.g. `Object.values(Enum)`) — drags `node:module`
into the browser bundle, Turbopack build fails (tsc/lint pass). Use `import type`
for enums or a client-safe mirror const (pattern: `INVITATION_STATUSES` in
lib/validations/invitation.ts). Phase 6's result/decision client islands will hit
this — import `DecisionOutcome` as a type and mirror its values for any client picker.

### Locked decisions (don't reopen)
Tailwind v4/shadcn; deterministic Python scoring service; LLM = config-gated seam
(ADR-030); tenant-scoped by orgId; role profiles versioned/immutable-when-approved;
candidate runner token-authorized (withCandidateToken, null user); invitation
tokens hash-at-rest (HMAC, lib/token.ts); audit ON for candidate answers; email
via lib/email.ts seam (Resend preferred over SMTP as of this session).
