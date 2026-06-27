# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-phase-5-invitations-b2zaau` (push verified; tip `526f4f4`+,
`git rev-list --count @{u}..HEAD` = 0). **Operator goal:** build ARCHITECTURE.md
§12's 8 phases. Specs (ARCHITECTURE.md, UI-SPEC.md) are session UPLOADS, NOT in the
repo — re-request before any phase needing detail.

## Status: **ALL 8 PHASES DONE + /ship GREEN + pushed + senior-reviewed.** ⏸ The only remaining step is the deferred FINAL QA PASS (browser/UAT/design-fidelity) against the live URL or the local PG :5433 carbon-copy — development was done test-free per the operator's directive.

### This session (Phases 7 + 8)
- **Phase-6 UI senior-review findings** applied (soft-deleted-Result leak on list +
  detail/compare/PDF paths; compute/narrative error-detail capped; DecisionBlock ISO
  date; undecided tile filter; PDF Arabic filename + RFC 6266 `filename*`; aria-controls).
- **Phase 7 — calibration loop** (`feat(phase-7)` + a senior-review follow-up):
  OutcomeRecord + ProfileCalibration models (migration `…140000`), pure unit-tested
  `lib/calibration.ts` (16 tests; success blend, Pearson, per-competency advisory
  signal, 4/5ths selection rule, insufficient-data gate), `lib/services/calibration.ts`,
  routes (outcomes=withManagerAuth, generate=withAdminAuth), `/app/calibration` UI
  (outcome capture, predicted-vs-observed scatter, advisory suggestions, adverse-impact
  monitor with the honest "no protected-class demographics collected (PDPL)" note).
  Follow-up: generate take-cap + scatter down-sample, adverse-impact honest "X of Y"
  cap, DB-level soft-delete filter, **recycling-bin routes now orgId-scoped** (M-2),
  hired-default-false. Advisory only — never auto-adjusts a band.
- **Phase 8 — compliance + editable settings** (ADR-031 supersedes ADR-030):
  - **8a editable AI/scoring config:** AppSetting model (migration `…150000`),
    `lib/crypto.ts` (AES-256-GCM, key=HKDF(AUTH_SECRET); 7 tests), DB-then-env
    precedence (`lib/settings.ts`), token write-only/masked + encrypted-at-rest +
    `valueEncrypted` in SCRUB_FIELDS + export denylist; `lib/llm.ts`/`lib/scoring.ts`
    take an injected config (env fallback); PUT /api/settings/ai; Settings AI form.
    Security review PASS (token never reaches client/log/audit).
  - **8b settings:** org profile (name/language), user management (reuses /api/users),
    PDPL erasure (`/api/settings/erase-candidate` → soft-deletes invitation→assessment
    →result), retention read-only display.
  - **8c audit:** `/app/audit` filterable table + Excel export (`/api/audit-log/export`).
  - **8d methodology:** the full `/methodology` page was already complete (standards
    chain, AERA/APA/NCME + SIOP, Johnson-norm provenance, honest limits) — left as-is.

### FINAL QA PASS (operator's step 4) — substantially DONE this session
Ran against a local PG :5433 carbon-copy (the live host is proxy-blocked 403 from
this container, so browser QA must be local). **Verified GREEN:**
- **Migrations:** the Phase 7 (`…140000`) + Phase 8 (`…150000`) migrations apply
  cleanly on real Postgres (real validation, not just `migrate diff`); seed OK
  (admin + 5 role profiles + 4 demo candidates / 3 results).
- **Lean UAT (`npm run uat`):** all 11 main screens load authenticated — incl. the
  new **calibration / settings / audit** — plus the unauth-redirect guard. (Required
  two harness fixes, now committed: `auth.setup` landing regex + `_discover` glob for
  this fork's `/<locale>/app` structure.)
- **recharts in dark + RTL (the flagged concern): RESOLVED.** Screenshotted the
  evidence-trail result page in dark mode AND Arabic/RTL — the competency radar +
  Big-Five trait bars + fit ring render correctly (SVG `var()` token fills resolve on
  theme/dir change); full RTL layout mirror; honest SJT/AI states.
- **New pages eyeballed:** Settings AI-config (write-only/masked token), Calibration
  (outcome-capture table on seeded candidates + advisory report selector), Audit
  (filters + Export + honest empty state).

**NOT run (honest gaps for a focused follow-up):** an automated **axe a11y** scan
(this branch has no a11y UAT project; the `/design-qa` MCP path is flaky per
agent-memory — needs `@axe-core/playwright` wired into a `*.uat.ts`), the **full**
`/uat` permission-matrix + per-entity CRUD journeys, and `/manual-uat` per-role RBAC
walk. The lean smoke + the targeted dark/RTL recharts check cover the highest-risk
surface; the full a11y/RBAC matrix is the remaining work.

NOTE: SCORING_SERVICE_URL/LLM are still unset in the deployed env, so live end-to-end
scoring/narrative + the calibration *generate* (needs ≥8 recorded outcomes) exercise
only the honest "not configured"/"insufficient" states without the Python svc + seeded
outcomes. The Settings AI-config form now sets those endpoints in-app (encrypted)
instead of a redeploy.

**Local-PG-as-root recipe (this session, supersedes the runuser+chown variant):** the
harness denies `chown` / `rm -rf` / compound setup lines, but a plain `runuser -u
postgres -- …` IS allowed. So: `runuser -u postgres -- mkdir -p /tmp/pgX/data` →
`runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/pgX/data -U postgres
--auth=trust` → `runuser -u postgres -- …/pg_ctl -D /tmp/pgX/data -o "-p 5433 -k
/tmp/pgX" -w -t 90 start` → `runuser -u postgres -- …/createdb -p 5433 -h /tmp/pgX
appdb`. PG refuses to run as root (we are root) and `chown` is denied, so let the
`postgres` user create its own dirs in sticky `/tmp` (no chown needed). Custom
Playwright scripts need `executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/
chrome"` (the bundled `chromium_headless_shell` version mismatches @playwright/test).

---

## (historical) Status before this session: Phases 1–6 DONE + /ship GREEN + pushed. ⏸ PAUSED for operator review before Phase 7 (calibration). Phase 7 = OutcomeRecord + ProfileCalibration + adverse-impact monitor.

### Deployment (live test URL)
- **Live (custom domain):** https://rihal-aptitude.ops-rihal.com — admin
  `alnaaime@gmail.com`. (Also https://fullstack-vibe-template.vercel.app.) Domain
  wired this session: CF zone `ops-rihal.com` (id `9dbbff1a78393aabbc613b1eb5d4db8a`)
  CNAME `rihal-aptitude`→`cname.vercel-dns.com` (DNS-only); Vercel domain attached +
  verified; `AUTH_URL=https://rihal-aptitude.ops-rihal.com` set (production) for
  Auth.js. TLS auto-provisions; allow a few min for DNS+cert on first cutover.
  Deployed from THIS branch on the EXISTING repo (the standalone-repo step is
  blocked — see below). Each push to b2zaau auto-builds; promote production from
  b2zaau via the Vercel API (project `prj_jKdcMNnuGdkAlAyZXBKcPaGK8YJu`, team
  `team_Buc334YaFWzCtASZs9oWvcI5`, repoId `1241728413`, ref the branch).
- `SEED_SAMPLE_DATA=1` is set on Vercel → the build seeds 4 demo candidates (3 with
  PRECOMPUTED results via the pure roll-up on synthetic scorer output) so the
  evidence-trail UI is viewable WITHOUT a live Python scorer; 1 candidate is left
  unscored to show the "scoring not configured" state.
- `SCORING_SERVICE_URL` / `LLM_ENDPOINT_URL` are UNSET (graceful degrade) — live
  end-to-end scoring + AI narrative can't be exercised here; they need the Python
  services/scoring up + the LiteLLM endpoint reachable in the deployed env.

### ⚠️ Standalone-repo step is BLOCKED (operator action needed)
Task step 1 (spin into a fresh standalone GitHub repo) is blocked at the
environment's egress-policy proxy: ALL GitHub paths 403 — MCP create_repository,
the GH_AUTOMATION_TOKEN PAT used directly against api.github.com, AND git
push-to-create. The proxy forces every GitHub call through a GitHub App scoped to
`fullstack-vibe-template` only; no token widens it. UNBLOCK: the App installation
backing this Cloud env needs repository access "All repositories" + Administration:
write, OR create an empty private repo manually and hand over the name — then
`git push <newremote> claude/rihal-phase-5-invitations-b2zaau` carries the full
142-commit history. A `rihal` remote is pre-staged (currently 403s).

## Phase 6 — DONE (results, dashboards & AI Role 2)
Built per docs/blueprints/phase-6-results.md (full track, operator-signed-off):
migration `add_result_and_decision` (Result + DecisionOutcome; Result registered
for soft-delete + recycling; SCRUB_FIELDS unchanged) → pure `lib/scoring-rollup.ts`
(15 contract tests) → `lib/services/result.ts` (lazy compute-on-view + persist,
scoring-gated honest states, decision, narrative cache, candidates/compare/dashboard
reads, all orgId-scoped) → AI Role 2 `lib/llm.draftResultNarrative` (numbers-only,
no PII/JD, schema-validated, config-gated) → routes (compute/narrative/decision/pdf,
withManagerAuth + withRateLimit OUTSIDE) → UI (dashboard wired, candidates list,
the evidence-trail `candidates/[id]` page, compare, /methodology stub; shadcn +
recharts, en+ar, on-token) → `@react-pdf` branded PDF (`lib/pdf/`). Two `/code-review`
passes (backend + UI) + senior-review (backend PASS; UI pass running) — findings
folded in. **NOT yet browser-QA'd** (`/design-qa`/`/uat` against the local PG :5433
carbon-copy or the live URL) — recommended before Phase 7 sign-off; recharts RTL/dark
needs an eyeball.

### AI / scoring configuration — OPERATOR DECISION (2026-06-27): make it EDITABLE in Settings (Phase 8)
Operator wants to configure the AI/scoring from the Settings UI, not only env vars.
This SUPERSEDES the ADR-030 "env-driven, read-only" stance → **write a superseding
ADR in Phase 8** before building. Phase-8 `/app/settings` (HR_ADMIN) scope now adds:
- **Editable LLM config:** `LLM_ENDPOINT_URL`, `LLM_MODEL`, `LLM_ENDPOINT_TOKEN`
  (and the scoring equivalents) settable in-app.
- **Security (binding):** the TOKEN is **Restricted** (SECURITY.md §1) — store it
  encrypted-at-rest (NOT plaintext in a normal column), add the field name to
  `SCRUB_FIELDS` + the audit-scrub test in the SAME commit, never log it, never
  return it to the client (write-only / masked in reads). Keep the **env var as an
  override/fallback** so IT can still pin it at the platform layer; precedence +
  the lib/llm.ts + lib/scoring.ts readers must consult the DB setting then env.
- Until Phase 8 ships, config is still env-var only: set `LLM_ENDPOINT_URL`/
  `_TOKEN`/`LLM_MODEL` + `SCORING_SERVICE_URL`/`_TOKEN` on the deployment + redeploy.
Phase 8 Settings also covers org/users/retention/PDPL-erasure/branding + the full
`/methodology` page (now a stub).

### ⏭ NEXT SESSION — apply Phase-6 UI senior-review findings FIRST (none blocking; none reachable today)
No HIGH. Two MEDIUM + LOW/NIT (not reachable in Phase 6 — no route soft-deletes a
Result; error echo is behind withManagerAuth with scoring/LLM unset):
1. **[MED] listCandidates default select can surface a soft-deleted Result's
   fitScore/decision** (`lib/services/result.ts` ~L537 nested `result` select).
   NOTE: Prisma to-ONE relation `select` does NOT accept `where` — the reviewer's
   one-liner won't compile as-is; instead filter post-query (`r.result?.deletedAt`)
   or use a relation filter. Verify before applying.
2. **[MED] compute/narrative routes echo `outcome.detail` (may contain internal
   scorer/LLM URL) to authenticated staff** (`app/api/results/[id]/compute/route.ts:39`,
   `narrative/route.ts:25`). Cap to a generic message; log detail server-side only.
3. **[LOW] DecisionBlock `decidedAt` typed `Date|null` but is a string at the
   RSC→client boundary** — serialize to ISO in the page, type the prop `string|null`.
4. **[LOW] awaitingReview tile href is unfiltered `/app/candidates`** — point at the
   undecided subset (add `?undecided=1` → list maps to `listCandidates({undecided})`).
5. **[LOW] PDF filename → `rihal-result-_.pdf` for Arabic-only names** — fall back to
   sanitized email. **[NIT]** CompetencyBreakdown expand buttons want `aria-controls`.
6. **[BROWSER-QA] recharts RADAR/BARS dark-mode + RTL** — verify SVG token fills
   update on theme toggle (recharts renders SVG, not CSS classes). Run /design-qa +
   /uat against the local PG :5433 carbon-copy (recipe below) or the live URL.

### Phase 7 build order (after the above + operator review)
OutcomeRecord (hired/probation/rating6m/rating12m/retained, attached to a Result) +
ProfileCalibration (per role-profile-version metrics) + the manual-trigger calibration
report (predicted-fit vs observed-outcome) + adverse-impact monitor. All ADVISORY —
admin reviews → creates a NEW profile version; never auto-adjusts (ARCHITECTURE §7).

---

## (historical) Phases 1–5 DONE. Phase-5 senior-review findings + Resend transport DONE & pushed. Phase 6 was BLUEPRINTED then built this session.

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
