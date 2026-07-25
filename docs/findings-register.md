# Findings register (wave-offs must be logged, never silent)

Every time a finding is **not fixed** — deferred, accepted as a known limitation,
declared an intentional trade-off, a "judgment call" handed to the operator, a
skipped QA phase, or a lint/rule suppression — it gets a dated line here. The
point is that "acceptable" is a recorded, reviewable decision, not a silent
shrug (complaint #12). `/qa` refuses to green a release while a wave-off touching
the changed surface is still **open** (un-adjudicated).

- **Security** suppressions (gitleaks / Semgrep / npm-audit / an ESLint security
  rule) go in **SECURITY.md §12**, not here — this register is for the rest
  (the four non-security pillars, UX/design judgment calls, skipped QA phases,
  deferred functionality).
- One line per wave-off. Newest at the top.
- Format: `YYYY-MM-DD — [pillar/area] <finding> — WHY waived — <owner/operator> — status: open | adjudicated(<date>) | fixed(<commit>)`
- A wave-off is **open** until the operator adjudicates it (accepts or schedules
  it) or it's fixed. Don't mark something adjudicated on the operator's behalf.
- **`fixed(<commit>)` must name a RESOLVABLE commit** — a real 7+ hex SHA that
  `git show` can find on the branch's history. Do NOT close with `fixed(this commit)`,
  `fixed(this branch)`, or `fixed(repo-audit)`: those become unverifiable the moment
  the register is read from any later commit (V2 challenge-audit D7). If the change is
  landing in the same commit as this line, close it in a follow-up amend/commit with the
  real SHA, or point at a durable tree artifact (a file/test path) instead. A pre-`main`
  squash can still orphan a SHA — when that happens, replace it with a tree-evidence
  pointer, don't leave a dead hash. (Historical `this commit`/`repo-audit` tokens below
  are NOT back-filled — this convention binds new entries.)

## Register

<!-- newest first -->

- 2026-07-25 — [secure/quality, item 16] The atomic-audit-triggers recipe
  (`docs/recipes/shared-security/4-atomic-audit-triggers.md`) had **never been executed** — 324
  lines of PL/pgSQL a `shared`-tier fork is told to paste in for tamper-evident, compliance-grade
  audit, with no test, no migration, and no evidence anywhere in the repo referencing
  `audit_row_change`. VERIFIED 2026-07-25 against real Postgres 16: the SQL was extracted verbatim,
  applied over all template migrations, and exercised with a 12-case battery (now committed at
  `docs/verification/atomic-audit-triggers/trigger-battery.sql`). **11/12 passed as written; ONE
  REAL DEFECT found + FIXED:** `audit_logs.userId` is a FK to `users.id` and the trigger inserted
  the `app.user_id` GUC unconditionally, so an unresolvable actor (an actor PERMANENTLY deleted via
  the recycling bin while holding a live JWT, or an SSO subject that isn't a `users` row) raised
  `foreign_key_violation` — and because the trigger runs in the caller's transaction, **the data
  write itself failed**. An audit mechanism must never take down the application it observes; the
  recipe now resolves the actor and degrades to a NULL (unattributed) actor instead, verified to
  still write the audit row. Re-verified 12/12 after the fix. The recipe's atomicity claim
  (`ROLLBACK` → 0 audit rows) and its bulk/`upsert` coverage — the cases the app-level extension
  cannot see — are now proven, not asserted. **NOT made the template default** (deliberate):
  ADR-010 accepts app-level audit for the prototype rail and the recipe itself says not to add
  trigger ceremony to a throwaway; item 16's value was making the opt-in path trustworthy. —
  owner: operator — status: fixed (this branch; evidence in
  `docs/verification/atomic-audit-triggers/`)

- 2026-07-25 — [maintainable/data, item 7 phase 2] The `Asset.category` COLUMN (+ the
  `AssetCategory` enum) is now DEAD but still in the database. OPEN-ITEMS item 7 retired the
  category enum axis in application code (operator decision: "drop the enum axis") — nothing reads
  or writes it any more; an asset's category comes from `model → AssetModel.category → Category`.
  The column was deliberately NOT dropped in the same release: `vercel.json` runs
  `prisma migrate deploy` on every build, so a `DROP COLUMN` shipped alongside the code that stops
  reading it would break any instance still serving the previous version mid-deploy (the
  `prisma.md` hard rule: "never drop columns the running version still reads"). This is phase 1 of
  an expand/contract migration. **PHASE 2 (a later, separate release):** delete the `category`
  field + the `AssetCategory` enum from `prisma/schema.prisma` and ship the `DROP COLUMN`
  migration; the schema comment on the field carries the same instruction. Safe once no running
  version reads the column — i.e. one deploy after this one. Until then new rows take the
  `@default(LAPTOP)`, which nothing consumes. — owner: operator — status: **fixed** (phase 2 SHIPPED
  2026-07-25, same session, operator chose "drop it now" once phase 1 was confirmed unreleased —
  nothing was ever deployed running the pre-phase-1 code, so the one-deploy soak had no work to do).
  Migration `20260725060000_drop_asset_category_enum_axis` drops the column then the type (that
  order matters — Postgres refuses to drop a type still in use). **Hand-written deliberately:**
  `prisma migrate dev` again proposed `DROP TABLE "document_embedding"` (the pgvector RAG store is a
  raw-SQL migration, not a Prisma model, so the differ mis-reads it as drift) — that drop was kept
  out, and the RAG table was verified still present after the migration ran. Verified: column gone,
  `AssetCategory` type gone, `document_embedding` intact, clean from-scratch replay of all
  migrations, typecheck green.

- 2026-07-24 — [multi/challenge-audit] A two-agent adversarial audit (docs vs. code/harness, charged to
  disprove) found 15 findings; the operator adjudicated each and 13 were fixed this session (2 handled
  as: D5 produce-a-real-artifact, D7 convention-note-not-backfill). **Fixed — HARNESS/SECURITY:**
  (H1) `no-secret-env-in-console` only caught `console.*(process.env.X)`, missing logger sinks
  (`logger.info(...)`), the `@/lib/env` wrapper, and `DATABASE_URL`-class credential URLs — a real
  secret-to-logs leak path; rule broadened + tests that had asserted the hole as VALID inverted
  (evidence: `eslint-rules/rules/no-secret-env-in-console.mjs` + `tests/eslint-rules/rules.test.mjs`).
  (M2) `dangerous-commands.mjs` had no semantic check for `git reset --hard`/`clean -f`/`checkout .`/
  `restore .`, so compound forms slipped the lexical deny-list — added (evidence: same file +
  `tests/harness/hooks.test.mjs`). (M3) `bash-write-gate.mjs` missed `touch`, a two-step create that
  defeated the existing-file exemption of the blueprint gate — added. (M4) `/ship`'s db-structure
  migrate-diff silently skipped without `SHADOW_DATABASE_URL` yet printed a clean `PASS`; degraded
  phases now print `PASS*` (evidence: `scripts/ship.mjs` `report`). (M5) `no-prisma-in-client` didn't
  cover the real generated client path `@/generated/prisma` — added. (L6) ship.mjs "7-step" header →
  real ~19-phase list. (L7) next `16.2.9` → `16.2.10` in comments/prose. **Fixed — DOCS honesty:**
  (D1) SESSION-HANDOFF/session-state claimed a frozen 2026-07-17 "no in-flight work" state 27 commits
  stale — re-stamped to the real branch/date + an honest post-close status. (D2) register cited the
  3-test `pgvector.test.ts` as "6/6" (the 6 is the full 2-file suite) → corrected to 3/3. (D3) three
  `fixed(<commit>)` hashes (205ddfe/34f1114/8d0aa61) were orphaned by a pre-`main` squash → repointed
  to tree evidence. (D4) harness-inventory undercounted the ESLint floor (10 vs 13) → fixed + the 3
  missing rules enumerated. (D6) WS-1 register said `pg17`; files use `pg18` → corrected. (D7) added a
  register convention: `fixed()` must name a resolvable commit, not `this commit`/`repo-audit`.
  (D8) asset-tracker NOTES overstated its capture matrix → described what's actually on disk.
  (D5) T11's "proven in-browser" audit-log claim had NO artifact → produced a REAL one against a live
  Postgres 16 (assets 3→5, 2 CREATE audit_logs rows, raw-SQL confirmed) at
  `docs/verification/asset-tracker/T11-csv-import-audit-proof.md`. — owner: operator — status: fixed
  (this branch; all changes present in the working tree, verified `eslint .` 0 errors +
  `test:lint-rules` 16/16 + `test:hooks` 68/68 + the D5 live-DB proof PASS)

- 2026-07-24 — [secure/supply-chain] `npm audit` was RED on the locked stack — 10 High+/Critical
  advisories NEWLY disclosed against the pinned deps (`@auth/core`+`next-auth`, `next`, `sharp`,
  `postcss`, `brace-expansion`, `fast-uri`, `js-yaml`, `find-my-way`, `@auth/prisma-adapter`), none
  in `audit-allowlist.json`. Pre-existing + repo-wide (not caused by the challenge-audit — that
  commit touched no `package.json`/lockfile). **FIXED (operator: "fix all")** via in-major security
  patches (ADR-017 currency, NOT an ADR-001 change): `next`→16.2.11 (9 Next.js advisories + bundled
  postcss/sharp), `next-auth`→beta.32 + `@auth/core`→0.41.3 + `@auth/prisma-adapter`→^2.11.3 (3
  Auth.js criticals), overrides for `postcss`/`sharp`/`brace-expansion`(ReDoS)/`find-my-way`;
  `fast-uri`/`js-yaml` via non-breaking `npm audit fix`. **High+ = 0, Critical = 0.** ONE advisory
  scoped-allowed (not silent): GHSA-mh99 (`brace-expansion` OOM) has no export-compatible fix (5.0.8
  breaks eslint/minimatch — verified) and is not runtime-reachable — allowlisted with SECURITY.md
  §12/§13 rows. 5 moderates remain, below the High+ gate (dev-only). Full `/ship` green after the
  bumps, no auth regressions. — owner: operator — status: fixed (this branch; `/ship` npm-audit gate
  green; SECURITY.md §13 "2026-07-24 — 10 High+/Critical advisories")

- 2026-07-18 — [quality/design, V2-302] Shared layout primitives lacked a dedicated visual-verification
  capture set — the `components/shared/*` primitives (PageShell, Section, Toolbar, FormLayout,
  StatGrid, DetailList, EmptyState) exist and carry a build-vs-buy ledger entry, and the V2-301
  visual-iteration loop (`npm run capture`) is wired, but the committed evidence for the primitives
  themselves was desktop-only / light+dark / en-only (`showcase-route-{light,dark}.png`) — no mobile
  and no RTL, short of V2-302's acceptance ("primitives exist with RTL+dark evidence captures").
  FIXED: captured the full V2-301 matrix `{desktop,mobile} × {light,dark} × {en,ar}` of the
  `/design-system` showcase (which renders the primitives) against the authed dev app (native-PG
  recipe), viewed all corners, and stored them + a 10-point self-critique (9/10) under
  `docs/verification/design-system/` (README "V2-301 capture matrix" section). `ar` was enabled only
  for the capture run and reverted, so the shipped English-only locale set is unchanged; the RTL cells
  prove the primitives mirror via direction-aware logical properties. — owner: operator —
  status: fixed(this branch, 2026-07-18)

<!-- 2026-07-18 register reconciliation (repo-audit): the five HARNESS-V2 "explicit deferrals"
     (BACKLOG §Explicit deferrals) were resolved post-close on 2026-07-18 and narrated in
     HARNESS-V2-CLOSEOUT.md, but never carried register lines (they lived only in the backlog/
     closeout deferral lists). Back-filled here so the ledger — not just the closeout prose —
     is the audit trail the operator reviews. Each is a deferral-then-fixed record; the operator
     still adjudicates. -->

- 2026-07-18 — [supply-chain/O5] SBOM-based license gate was a HARNESS-V2 explicit deferral (superseded-items map: "O5 license gate DEFERRED → register line") that never got its register line — SHIPPED post-close: `scripts/sbom-license-gate.mjs` + `npm run license:sbom`, wired into `ship:full`, evaluates the CycloneDX SBOM against the ADR-051 deny set + `license-allowlist.json`. — owner: operator — status: fixed(94a89cb; senior-review fixes f077a7a)
- 2026-07-18 — [harness/P6] Worktree-isolation recipe for parallel waves was an explicit deferral ("P6 worktree recipe DEFERRED → register line", document post-V2-105) with no register line — SHIPPED post-close: the `/fan-out` SKILL.md gained a "Worktree isolation" recipe (native `Agent isolation:"worktree"` + the manual `git worktree add`/merge/remove wave), closing the attribution-limit gap the skill names. — owner: operator — status: fixed(d7ec9c3)
- 2026-07-18 — [docs/#17] SECURITY.md size review was an explicit deferral (full rewrite out of scope) with no register line — DONE post-close (operator chose "reformat for readability"): §11 (threat findings) + §13 (CVE remediations) reformatted from wide single-line table cells into a lean index + per-item subsections, zero content loss (85/85 cells verified verbatim), 104.6 KB → 88.1 KB. — owner: operator — status: fixed(0cb4353)
- 2026-07-18 — [harness/#22] Marketplace publication was an explicit deferral ("#22 actual marketplace publication") with no register line — RESOLVED post-close (operator chose "prepare, don't publish"): ADR-062 supersedes the ADR-054 private posture to publication-READY-but-intentionally-unpublished; `docs/plugin-publish-readiness.md` is the checklist; `plugin.json` `x-posture` updated. Nothing published — publication stays a deliberate operator step. — owner: operator — status: fixed(153ac9d)
- 2026-07-18 — [harness/#27] Bus-factor program was an explicit deferral (#27 full program out of scope) with no register line — bounded slice SHIPPED post-close (operator chose "bounded slice now"): `docs/harness-orientation.md` (mental-model map of the eight harness systems + contributor onboarding), complementing the V2-505 maintainer-runbook floor. The full multi-maintainer/CI-activation program remains larger and deliberately out of scope. — owner: operator — status: fixed(153ac9d; review f077a7a)
- 2026-07-12 — [speed/size-limit] sizeLimitAck (ADR-025) — the OpenAPI contract seam (ADR-052) ships the Scalar API-reference UI (`@scalar/api-reference-react`) in the template, which adds ~0.67MB gzipped to the summed client-chunk budget (`.size-limit.json`: 1.87MB vs 1.2MB). Scalar is dynamically imported (`ssr:false`) and auth-gated on the dev-only `/api-reference` page, so it is NOT in the app's first-load/first-paint payload — but `.size-limit.json` globs `.next/static/chunks/**` and sums ALL route chunks, so a lazy chunk still counts. The dependency itself is operator-accepted in ADR-052 (Accepted 2026-07-12, Tariq Al-Naaimi); this line records the bundle-budget consequence of that locked decision. Fix path if the budget matters to a fork: gate the Scalar page behind a per-fork opt-in (a follow-up increment) so a non-`/api/v1` fork doesn't ship it. — owner: operator — status: fixed(item-2 closeout, 2026-07-12) (FIXED via the size-limit opt-in refactor the operator chose: `@scalar/api-reference-react` removed from package.json + the `/api-reference` page removed from `app/`, so the default template ships neither and the summed client-chunk budget is back under 1.2MB with `sizeLimitAck` removed. A fork that serves `/api/v1` opts in with `npm run enable:api-reference`, which writes the page + installs the dep and accepts the ~0.67MB cost for that fork only. Honors ADR-052's "zero-cost for non-consumer forks" claim.)
- 2026-07-11 — [quality/ai] ai-eval /ship gate is DORMANT — the LLM-as-judge eval gate
  (`scripts/ai-eval.mjs`, wired into /ship phase B) is a no-op that exits 0 (SKIP) until a fork
  BOTH sets AI_API_KEY and writes >=1 tests/ai-evals/*.eval.ts fixture (and points AI_EVAL_BASE_URL
  at a running/deployed app). The pristine template has neither, so it always SKIPs green — AI
  output-quality scoring is unenforced here BY DESIGN, mirroring the dormant lhci gate (ADR-020
  dormancy pattern). Not silently dropped: it self-activates the moment a fork turns AI on + writes
  fixtures, and a CI variant (ai-eval.yml against a preview URL) is scheduled to land at the
  ADR-007/037 Actions-activation line. — owner: operator — status: adjudicated(2026-07-11)
  (accepted: dormant-by-design gate on the ADR-020 pattern; self-activates per-fork)
- 2026-07-11 — [quality] WS-5 pgvector RAG seam (ADR-043) is UNVERIFIED in-session —
  lib/ai/embeddings.ts + lib/ai/rag.ts + prisma/migrations/20260711120000_pgvector_rag were authored
  to spec, but there is **no pgvector-enabled Postgres and no embeddings egress** in the build
  environment, so the migration is **UNAPPLIED** and no provider round-trip or vector query ran here.
  Like the WS-1 distroless image wave-off, verification is delegated to a fork/CI with the
  infrastructure. Highest-risk unknowns a fork must confirm: the `vector` extension + `<=>` cosine
  operator + HNSW index resolve on the target Postgres (Neon supports `vector`), and the chosen
  model's dimension matches `vector(1536)` (voyage-3 / embed-english-v3.0 emit 1024 — ALTER the
  column + set EMBEDDINGS_DIMENSIONS in lockstep, else INSERT fails loud). **Not silently dropped —
  recorded for the operator to adjudicate**; the fix at activation: apply the migration against a
  pgvector DB, set EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY, and exercise ragUpsert/ragQuery. —
  owner: operator — status: adjudicated(2026-07-11) (accepted: infra-unavailable in-session;
  verification delegated to a pgvector-capable fork/CI, same posture as the WS-1 image wave-off)
  — **UPDATE 2026-07-17 (V2-402): the pgvector SUBSTRATE is now VERIFIED in-session** against
  native Postgres 16 + pgvector 0.6.0 (the env-unblock recipe, agent-memory 2026-07-17). The
  migration `20260711120000_pgvector_rag` is applied, and `tests/integration/pgvector.test.ts`
  (3/3 via `npm run test:integration`; 6/6 across the full two-file integration suite) proves the highest-risk unknowns this wave-off named: the
  `vector` extension + the `<=>` cosine nearest-neighbor query (returns the aligned doc, distance
  ~0) + the HNSW index in the plan (`document_embedding_embedding_cosine_idx`) + a wrong-dimension
  INSERT failing LOUD (the 1024-trap), all pass. The test SKIPS gracefully with no DB. **STILL
  UNVERIFIED:** the embeddings PROVIDER round-trip (text→vector via voyage/cohere) — needs
  `EMBEDDINGS_API_KEY` + egress this env lacks. **ADJUDICATED — SPLIT (operator, 2026-07-17):**
  (a) the **DB-substrate half is `fixed(8fb4737)`** — the `vector` extension + `<=>` cosine query +
  HNSW plan + dimension-trap are proven by `tests/integration/pgvector.test.ts` (3/3) against native
  Postgres 16 + pgvector; (b) the **provider round-trip half stays `waived`** — `ragUpsert`/`ragQuery`
  through a real embeddings provider is deferred until a fork sets `EMBEDDINGS_PROVIDER` +
  `EMBEDDINGS_API_KEY` with egress (fix at activation: apply the migration, set the keys, exercise the
  round-trip). The two halves are tracked independently; only the substrate is closed.
- 2026-07-11 — [quality] WS-6 Ory Polis SSO/SCIM seam (ADR-045) is UNVERIFIED in-session —
  lib/sso/* + app/api/internal/scim + the generic OIDC provider in lib/auth.ts + the `sso` compose
  profile were authored to the documented Ory Polis / BoxyHQ dsync contract, but **no live Polis
  sidecar was booted**, so the OIDC handshake params (`checks:["state"]`, client_secret_post) and
  the SCIM webhook shape ran no real round-trip. ADR-045 + the blueprint promised this line; it is
  now recorded (senior-review 2026-07-11 flagged the promised-but-missing entry as a governance gate
  hole). Verification delegated to a fork/CI with a real IdP, same posture as the WS-1 image + WS-5
  RAG wave-offs. Fix at activation: `--profile sso` up, create a Polis SSO connection, complete a
  SAML→OIDC login + a dsync provisioning event end-to-end. — owner: operator —
  status: adjudicated(2026-07-11) (accepted: infra-unavailable in-session; verification delegated to
  a Polis-capable fork/CI)
- 2026-07-11 — [secure] ADR-041 P0 item (c) — **SAST-as-a-hard-CI-gate + `zizmor` action-pin
  audit are DEFERRED to CI activation, not landed in WS-2.** ADR-041 and the enterprise-P0
  blueprint (AC-4.3) list "promote `sast.yml` from dormant to a hard blocking gate" + add `zizmor`
  as P0. On the current free GitHub plan Actions billing is blocked, so every CI workflow —
  `sast.yml` included — is intentionally dormant (`on: workflow_dispatch` only; ADR-007/037): flipping
  the push/PR triggers now would fail-in-2s, not gate anything. So the _hard-gate_ half is only
  meaningful once CI activates (at `/handoff` to a paid-Actions team, or when billing unblocks) — the
  same activation line ADR-037 already defines. **Interim control:** the Semgrep ruleset is mirrored
  locally by the `/audit` skill (runs on demand), and the trivy-pin + SHA-pin halves of ADR-041 P0
  DID land in WS-2a. **Update 2026-07-13 (ADR-050 account-free slice):** the `zizmor` gate is now
  AUTHORED as a dormant workflow (`.github/workflows/zizmor.yml` — PyPI-pinned `zizmor==1.26.1`,
  fails on unpinned actions/dangerous triggers, SARIF upload), so the fix at activation shrinks to
  restoring the real push/PR triggers on BOTH `sast.yml` and `zizmor.yml` — no authoring work
  remains. **Not silently dropped — recorded here for the
  operator to adjudicate.** — owner: operator — status: adjudicated(2026-07-11) (accepted:
  program-level deferral to CI activation — the risk description stands, but the _hard-gate_ half is
  only meaningful once Actions runs; interim control is the local `/audit` Semgrep mirror + the
  landed trivy/SHA pins. RE-OPENS at the CI/Actions-activation line — `/handoff` to a paid-Actions
  team, or billing unblocking — when `sast.yml`'s and `zizmor.yml`'s push/PR triggers are restored)
- 2026-07-11 — [quality] WS-1 Docker image build is UNVERIFIED in-session — the enterprise self-host
  image (distroless Node 24 + `compose.prod.yaml` + Caddy) was authored to spec but there is **no
  Docker daemon in the build environment**, so it was not built/booted here. Per ADR-030 the image
  gate degrades to a WARN when no daemon is present and build-verification is delegated to CI
  (`docker-build.yml`) or a build-capable machine. Highest-risk unknown a build must confirm: the
  Prisma 7 client/query-engine resolves at runtime inside distroless `nodejs24-debian12` (glibc +
  libssl present, but confirm on a real boot). Base tags are patch-pinned; Renovate applies the
  `@sha256:` digest pin (ADR-041). — owner: operator — status: adjudicated(2026-07-11) (accepted:
  infra-unavailable in-session — no Docker daemon in the build env; per ADR-030 the image gate
  degrades to a WARN and build-verification is delegated to a build-capable env, same posture as the
  pgvector RAG wave-off above. The runtime-resolution risk stands unchanged. RE-OPENS when the
  `docker-build` CI workflow — or a build-capable machine — actually builds + boots the distroless
  image and confirms the Prisma 7 client/query-engine resolves at runtime)
  — **UPDATE 2026-07-17: VERIFIED + FIXED in-session** (a Docker daemon became available this
  session — `sudo dockerd`, overlayfs, registry egress OK — so the RE-OPEN condition was met).
  Building + booting the image as-authored surfaced **five real latent defects** the never-run
  build had hidden (Vercel masked them because AUTH_SECRET is a configured env there): (1) the
  builder stage set a dummy `DATABASE_URL` but no `AUTH_SECRET`, so `next build`'s page-data
  collection threw a zod error (`lib/env.ts` validates at module load); (2) no `public/` dir
  existed, so the runner `COPY /app/public` failed the build; (3) the runner cherry-picked only
  `node_modules/prisma` + `@prisma`, so the Prisma 7 CLI crashed at boot with `Cannot find module
'effect'` (its runtime closure — @prisma/config → effect/c12/jiti, iconv-lite, … — was absent);
  (4) `prisma.config.ts` (which supplies the datasource url in Prisma 7; schema.prisma has no
  `url`) was not copied, so `migrate deploy` errored "datasource.url required"; (5) not a defect —
  the pgvector migration needs a `vector`-capable Postgres (Neon/pgvector image), not plain
  postgres. Fixes (operator-approved this session — robust variant): build-only placeholder
  `AUTH_SECRET`, `public/.gitkeep`, ship the production-pruned `node_modules` (full Prisma CLI
  closure) via `npm prune --omit=dev`, and copy `prisma.config.ts`; `docker-build.yml`'s smoke-test
  Postgres switched to `pgvector/pgvector:pg18` (aligned to the production pg18 in a follow-up; the CI smoke-test image matches `compose.prod.yaml`). **Proven end-to-end:** the committed Dockerfile
  builds (1.87 GB, from a non-booting 587 MB), boots as nonroot (uid 65532), applies all 7
  migrations against pgvector, and serves (HTTP 307). The register's named highest-risk unknown is
  answered: the Prisma 7 client/query-engine DOES resolve at runtime in distroless — but only with
  the dependency-closure fix. The ~1.87 GB size is the known cost of in-image migration (the heavy
  Prisma 7 CLI + Next standalone). — owner: operator — status: fixed(2026-07-17, operator-approved)
- 2026-07-03 — [maintainable] deferred-adoption #11 (specialist-agents) — **drop REVERSED by
  operator same day; now ADOPT.** The earlier drop reasoned that a stack-aware _review_ seed would
  duplicate `senior-code-reviewer`. The operator redirected it: build it as a **build-time ADVISOR**
  (not a reviewer), which occupies a genuinely different slot (advice while building vs. review after
  push) and does not duplicate the review rail. Design + skill-vs-subagent mechanism analysis pinned
  in `docs/blueprints/deferred-11-specialist-stack-advisor.md`. **IMPLEMENTED session 15 (2026-07-03)**
  as the `/stack-advisor` skill (`.claude/skills/stack-advisor/SKILL.md`, wired into
  `.claude/skill-rules.json`) — one composed advisor, positive patterns only, explicit
  "I advise, I do not review" boundary; the optional thin subagent was not built (no offload need yet).
  — owner: operator — status: fixed (commit 8d0aa61 was squashed away before it reached `main`, so the hash no longer resolves; the change is present in the tree — evidence: `.claude/skills/stack-advisor/SKILL.md` + its `.claude/skill-rules.json` wiring) (blueprinted → built → landed via squash)
- 2026-07-02 — [secure/maintainable] pristine-flag CLEARING is best-effort (warn-only, no
  retry/ack): `new-project.mjs` reads back `project.config.json` via the GitHub Contents API
  immediately after template-`generate` (which populates the file tree asynchronously) with no
  poll/retry, and `deploy.mjs` rewrites the flag only in the local working copy and relies on the
  operator to commit. If either clear silently fails, the fork keeps `"pristine": true` and — until
  it runs `/scaffold-entity` — ships GREEN with zero domain models, narrowly reopening the bypass
  the pristine-flag fix closed (originally commit 34f1114, since squashed away — see the entry below) (senior-review 2026-07-02, confidence 84) — WHY deferred: the
  robust fix (mirror new-project's existing env-propagation retry loop for the Contents read + a
  `dbAck`-style breadcrumb so `scanDbStructure` refuses a stale `pristine:true` whose clear failed)
  is Ask-before fork-script surgery, and Workstream B item 4 already reopens these three provisioning
  scripts next session; risk is narrow (only a not-yet-scaffolded fork whose clear silently failed)
  — owner: operator — status: adjudicated(2026-07-02) scheduled into Workstream B item 4
- 2026-07-02 — [secure/maintainable] db-structure gate's pristine-template exemption keys
  only on `package.json.name === "fullstack-next-template"`, which only `/rebrand` rewrites —
  a fork created via `/new-project`/`/deploy` without `/rebrand` stays silently exempt from
  the ADR-031 domain-model check (`scripts/ship.mjs` `TEMPLATE_PKG_NAME`; senior-review
  2026-07-02, confidence 85) — WHY deferred: fix needs a coordinated stamp across all three
  fork-creation scripts (or a `project.config.json` pristine flag), too invasive at session
  end; checks (b)+(c) still run everywhere — owner: operator — status: fixed (commit 34f1114 was squashed away before `main`, so the hash no longer resolves; the change is present in the tree — evidence: `"pristine": true` in `project.config.json` + `cfg.pristine === true` read in `scripts/ship.mjs` `scanDbStructure`)
  (replaced the package-name proxy with an explicit `"pristine": true` flag in
  project.config.json read by `scanDbStructure`; every fork-creation path clears it —
  rebrand.mjs, deploy.mjs, new-project.mjs)

- 2026-07-16 — [harness-v2 V2-001/correctness] `bash-write-gate.mjs`'s redirection regex scans
  the WHOLE command string including heredoc bodies / quoted example text, so a Bash command that
  merely MENTIONS a gated path (`> app/api/foo/route.ts` in documentation text, a `git commit -m`
  body, an `echo`) false-denies even though no write occurs (senior-review 2026-07-16, confidence
  85; observed live — a verification command this session was itself denied). WHY not fixed now:
  the fix (strip heredoc bodies / model shell-syntax vs data before scanning) is real parser work,
  risky at the session's context limit. Interim mitigation: avoid embedding literal gated-path
  redirect text in Bash commands. — owner: operator — status: adjudicated(2026-07-16) (scheduled:
  fix early next session per operator)
- 2026-07-16 — [harness-v2 V2-001/secure] `bash-write-gate.mjs` is evadable by writes that avoid a
  literal `>`/`tee`/`cp`/`sed -i` token: a shell variable holding the path (`F=…; cat > "$F" …`) or
  an interpreter one-liner (`node -e "fs.writeFileSync('app/api/x/route.ts',…)"`) creates a new
  uncovered gated file without tripping the gate (senior-review 2026-07-16, confidence 88). WHY not
  fixed now: the hook is best-effort by design (its header says so) and the Write-tool gates still
  catch the normal path; closing these needs variable-tracking / interpreter-verb heuristics. —
  owner: operator — status: adjudicated(2026-07-16) (scheduled: add hardening heuristics in a later
  phase per operator; add negative tests documenting the gap)
- 2026-07-16 — [harness-v2 V2-001/maintainable] ledger-coverage logic was duplicated between
  `build-vs-buy-gate.mjs` and `.claude/hooks/lib/scope-cover.mjs` (would diverge when V2-309 adds ledger hygiene;
  senior-review 2026-07-16, confidence 85) — owner: operator — status: fixed (commit 205ddfe was squashed away before `main`, so the hash no longer resolves; the change is present in the tree — evidence: `.claude/hooks/build-vs-buy-gate.mjs` imports `ledgerCoverInfo`/`relPath`/`isGatedCapabilityFile` from `./lib/scope-cover.mjs`) (refactored
  `.claude/hooks/build-vs-buy-gate.mjs` onto `.claude/hooks/lib/scope-cover.mjs`; one shared coverage implementation; the hook suite
  confirmed behavior unchanged at the time — the suite is 68/68 today)

- 2026-07-16 — [harness-v2 V2-101/correctness] the "zero rule-content loss" claim was FALSE:
  ADR-020 (senior-review CI path + `install-senior-review.mjs` portability) and ADR-048 (React
  Compiler build-time note) were dropped in the constitution split; the keyword sweep used a
  hand-picked list that missed them (senior-review 2026-07-16, confidence 92) — owner: operator —
  status: fixed(this commit) (restored both to `.claude/rules/harness.md`; added a mechanical
  `ADR-\d+` set-diff test to `tests/harness/hooks.test.mjs` so any future dropped ADR reds).
- 2026-07-16 — [harness-v2 V2-101/correctness] rules-injection globs under-matched:
  `lib/api-helpers.ts`, `lib/rate-limit.ts`, `lib/auth.ts`, `middleware.ts`, `lib/email.ts`,
  `lib/export.ts` (named in the rule files' own Ask-before/traps) matched no glob, so the hook
  never fired there (senior-review 2026-07-16, confidence 90) — owner: operator — status:
  fixed(this commit) (added those files to `api-routes.md`/`deploy.md` globs; also narrowed
  `deploy.md`'s `scripts/**` to the four deploy scripts to remove the harness.md double-injection
  overlap; added per-file + per-rule-file frontmatter regression tests).
- 2026-07-16 — [harness-v2 V2-101/operational] harness self-docs drift: `docs/harness-inventory.md`
  §5 hook table + count and `.claude/README.md` do not list the new `rules-injection.mjs` hook
  (senior-review 2026-07-16, confidence 82) — owner: operator — status: fixed(this commit) (added
  the `rules-injection` row + corrected the hook count 13→14 in `docs/harness-inventory.md` §5 +
  overview table, and a `rules/*.md` section to `.claude/README.md`).

- 2026-07-16 — [harness-v2 V2-102/correctness] `memory-digest.mjs` `boldOf` used prefix matching
  (`rawName.startsWith(bold)`) → a section whose name is a prefix of another silently corrupted both
  digest counts with no warning (senior-review 2026-07-16, confidence 92) — owner: operator —
  status: fixed(this commit) (switched to EXACT bold↔section-name matching + duplicate-match flag;
  reproduced-then-fixed).
- 2026-07-16 — [harness-v2 V2-102/invariant] the digest `(N)` count could drift from a section's
  real entry count on any path except `--write` — check-mode/`--strict`/session-start never noticed
  (senior-review 2026-07-16, confidence 88) — owner: operator — status: fixed(this commit) (check-mode
  now flags a `(N)` that mismatches the live `entryCount`; `--strict` reds on drift — demonstrated).
- 2026-07-16 — [harness-v2 V2-102/quality] three doc nits from the same review — newest-at-top order
  broken in 2 themed sections; `/remember` SKILL example + promotion-tree still named the old
  `## Gotchas & landmines`; `docs/harness-inventory.md` hook count inconsistent (13 vs 14, actually 15,
  missing `bash-write-gate`/`routing-receipt` rows) — owner: operator — status: fixed(this commit)
  (sections re-sorted; SKILL updated to themed sections; inventory corrected to 15 + both rows added).

- 2026-07-16 — [harness-v2 V2-103/correctness] `hook-latency.mjs` summed mutually-exclusive
  PreToolUse matcher groups (Edit + Bash + Read) into one 9-hook "chain" that never co-fires, and
  fed Edit-shaped input to the Bash-matcher hooks (which early-exit) — so the recorded baseline was
  a fiction, not any real per-turn latency (senior-review 2026-07-16, confidence 92) — owner:
  operator — status: fixed(this commit) (rewrote to measure per-turn chains separately — edit-turn
  vs bash-turn, each with tool-shape-correct input — and baseline against the worst turn; re-recorded
  hookChainMs 591→374).
- 2026-07-16 — [harness-v2 V2-103/correctness] `hook-latency.mjs` discarded the `spawnSync` result,
  so a mis-resolved/failed hook silently recorded near-zero instead of failing loud (senior-review
  2026-07-16, confidence 82) — owner: operator — status: fixed(this commit) (now checks
  `res.error`/`res.status`, prints an unreliable-measurement WARN, and `--strict` exits 1 on it).
- 2026-07-16 — [harness-v2 V2-103/completeness] the `hardest-gated` qualifier trimmed from the
  Secure pillar in `CLAUDE.md` was not preserved in `docs/uat-rubric.md` (senior-review 2026-07-16,
  confidence 88) — owner: operator — status: fixed(this commit) (added it to the rubric's Secure
  pillar). Note: the review confirmed the `ship.mjs` wall-time warn + `session-start.sh` context
  block are correctly fail-open, and the two other trimmed pillar tails are intact in the rubric.

- 2026-07-16 — [harness-v2 V2-107/**security**] the deny-list change removed `Bash(git branch -d *)`
  leaving only `Bash(git branch -D*)`, so `git branch -d -f` / `-d --force` / `--delete --force`
  (force-delete via flag combo) fell through to the `git branch*` allow and were **silently
  permitted** — a real regression, reproduced live (senior-review 2026-07-16, confidence 95) —
  owner: operator — status: fixed(this commit) (added a **semantic** force-delete guard to
  `dangerous-commands.mjs` — denies `-D` and any delete+force flag spelling/order, allows the bare
  safe `-d`; regression test in `tests/harness/hooks.test.mjs`).
- 2026-07-16 — [harness-v2 V2-107/architecture] `.claude/settings.json`'s permission arrays — the
  control over what an agent may run without a human — were NOT on the Ask-before surface and had no
  gate hook; this wave widened them via a subagent with only a self-reported note (senior-review
  2026-07-16, confidence 90) — owner: operator — status: fixed(this commit) (added
  `.claude/settings.json` `permissions` to the Ask-before list in `CLAUDE.md` + `.claude/rules/harness.md`;
  a PreToolUse settings-permission gate hook is SCHEDULED as a follow-up — heavier, next session).
- 2026-07-16 — [harness-v2 V2-104/completeness] three trims from the constitution weren't preserved:
  `dnd-kit`'s ADR-001 lock (only CLAUDE.md asserted it), the auto-plan "name the trigger" guidance,
  and the Stop-hook "uncommitted WIP is a warning" nuance (senior-review 2026-07-16, confidence
  82-85) — owner: operator — status: fixed(this commit) (dnd-kit+recharts added to
  `ADR-001-template-baseline.md`; the other two restored to `.claude/rules/harness.md`).
- 2026-07-17 — [harness-v2 V2-106/supply-chain] `npm run tokens` uses `npx -y ccusage@latest`
  (unpinned float; matches the pre-existing `scan`/`lhci` `@latest` floats — not a new deviation)
  (senior-review 2026-07-16, confidence 88) — owner: operator — status: scheduled (not a new
  deviation — matches the pre-existing `scan`/`lhci` `@latest` floats; pin `ccusage` + `scan` +
  `lhci` in a follow-up. Low urgency, `npm audit` clean, blast radius is a local dev-reporting
  tool. Operator: re-open if you want it prioritized).

- 2026-07-17 — [harness-v2 V2-105/correctness] `scripts/fan-out.mjs` `globsOverlap` used a
  representative-path heuristic (wildcards → literal `x`) that was **false-disjoint** for
  mid-segment wildcards — `check-overlap` would PASS a colliding manifest (e.g.
  `lib/validations/order*.ts` ∩ `lib/validations/*.test.ts` collide on `order.test.ts`), defeating
  the exact hard-enforcement the operator's custom verdict was chosen for (senior-review 2026-07-17,
  confidence 97) — owner: operator — status: fixed(this commit) (replaced with a sound
  segment-by-segment glob-intersection `segmentsIntersect` + `**` segment absorption; all 4 reviewer
  counterexamples now detected; regression test in `tests/harness/hooks.test.mjs`).
- 2026-07-17 — [harness-v2 V2-105/correctness+invariant] `verify-scope` (a) ran `git status
--porcelain` without `-uall` (a brand-new dir collapsed to one entry → mis-flagged a correct wave)
  and (b) asserted its clean-tree precondition in docs only (a pre-existing dirty file was absorbed
  as wave output / mis-blamed) (senior-review 2026-07-17, confidence 88-90) — owner: operator —
  status: fixed(this commit) (added `-uall`; `check-overlap` now snapshots the pre-wave dirty set to
  a `.baseline` that `verify-scope` subtracts; temp-git integration test covers both).
- 2026-07-17 — [harness-v2 V2-105/documentation] ADR-057 + SKILL.md claimed `/fan-out`
  "hard-verifies each unit wrote only its files" — but native dispatch shares ONE working tree, so
  the check is the weaker **aggregate-disjoint** property (no per-subagent attribution)
  (senior-review 2026-07-17, confidence 85) — owner: operator — status: fixed(this commit) (docs
  narrowed to the true guarantee; per-unit worktree isolation moved to an ADR-057 migration trigger;
  the Low "bare OK on zero changed files" also fixed — verify-scope now names silently-no-op'd units).
- 2026-07-17 — [harness-v2 V2-105/observability] `.claude/hooks/routing-receipt.mjs` (the
  `PostToolUse(Task)` receipt sink at `.claude/state/routing-receipts.jsonl`) does **not** populate
  for async background-Agent dispatch in this web environment — observed twice (V2-106/107 wave and
  the V2-105 research wave). The parallel-wave evidence trail is git-diff disjointness +
  `/fan-out verify-scope`, neither of which depends on the receipt hook — owner: operator —
  status: fixed(repo-audit) (root cause: the hook + its PostToolUse matcher keyed on tool_name
  `Task` only, but the Agent SDK / web environment dispatches subagents via the `Agent` tool.
  Broadened BOTH the `.claude/settings.json` matcher (`Task|Agent`) and the hook guard to accept
  either name; verified a synthetic `Agent` dispatch now writes a receipt row while `Task` still
  works and unrelated tools are ignored. `routing-report.mjs` stays observe-only).

- 2026-07-17 — [harness-v2 V2-210/parity] Asset Tracker pilot DEFERS three ITAM table-stakes rows
  from `docs/benchmarks/it-asset-management.md` (dispositioned in `docs/blueprints/asset-tracker.md`):
  T2 Model→Category→Manufacturer hierarchy (pilot ships a flat `category` enum), T9 Custom fields
  (Fieldset model), T11 Bulk CSV import — owner: operator — status: fixed(repo-audit — all three
  built + verified 2026-07-18; see the UPDATE/SUPERSEDED notes below) (originally scheduled: the pilot is a
  table-stakes slice to exercise the loop, not a full ITAM suite; each was a `/scale-up` follow-up:
  T2 via `--relations` to Model/Category models, T9 via a custom-field model, T11 via the import
  recipe. Re-open when the Asset Tracker graduates from pilot to a real tool).
  — **UPDATE 2026-07-18 (repo-audit):** operator asked to build all three out now. Attempted — but
  the web container has **no Docker daemon, no native Postgres, no `DATABASE_URL`** (egress-restricted),
  so the required Prisma **migrations cannot be generated/applied or verified**, and T11's audited
  bulk-create path cannot be exercised, here. — **SUPERSEDED 2026-07-18:** a native Postgres 16 +
  pgvector was stood up in-container (operator confirmed the env has access), so the DB blocker is
  gone. **T2 (hierarchy) is now BUILT + verified** — `Category`/`Manufacturer`/`AssetModel` entities
  (migration `20260718152957` applied + seeded), `Asset.modelId` FK, cascading Model picker on the
  form, Model column on the list; captured live (`docs/verification/asset-tracker/`, real seeded
  hierarchy renders) and `/ship`-green. Refactor extracted 3 shared primitives
  (`RowActions`/`RelationSelect`/`parseListQuery`) to hold jscpd < 3%. **T9 (custom fields) is now BUILT + verified**
  (5c): `CustomFieldDef` entity (migration `20260718161010`, admin-managed via `/api/custom-field-def`)
  - `Asset.customFields` Json; the form renders one input per active def (fetched live) and the API
    boundary validates values against the defs (required/type/unknown-key) via `validateCustomFields`;
    captured live (seeded "Cost center"/"Warranty expiry" render on the form). — **T11 (CSV import) is
    now BUILT + verified** (5d): `POST /api/asset/import` (editor-gated, rate-limited) parses CSV via
    the hand-rolled unit-tested `lib/csv.ts`, validates each row with `createAssetSchema`, and creates
    them with per-row `prisma.asset.create` inside ONE `$transaction` — **NOT `createMany`** (ADR-010 /
    `no-unaudited-bulk-write`), atomic + row-indexed errors + a ≤500 cap; a list-page panel drives it.
    **Proven with a committed artifact (D5, 2026-07-24)**: the original "proven end-to-end in-browser"
    claim left NO evidence file (challenge-audit finding D5). Now backed by a real run against a live
    Postgres 16 — a 2-row CSV (incl. a quoted-comma `name`) → 2 assets created (3→5) → **both carry
    CREATE `audit_logs` rows** (raw-SQL count = 2; a `createMany` bulk bypass would show 0). Exercised
    the SAME `@/lib/*` modules + the exact `$transaction(per-row create)` pattern from
    `app/api/asset/import/route.ts:73`; artifact + method + reproduce steps in
    `docs/verification/asset-tracker/T11-csv-import-audit-proof.md`. (Fidelity: run at the service layer,
    not through the HTTP endpoint — so `userId` is NULL; the audit-row-per-create invariant itself is
    exercised exactly.) **All three deferred rows T2/T9/T11 are DONE** — this V2-210/parity line is fully
    resolved. See V2-307 for the CTA fix.

- 2026-07-17 — [harness-v2 V2-210/correctness] the pilot's two-stage senior review found 1 High + 2
  Medium + 1 Low in the hand-layered pilot code (Stage 1 confirmed scope-clean + caught the AC drift;
  Stage 2 found the code bugs) — owner: operator — status: fixed(this commit): **High** — the
  scaffold-generated `AssetForm` assignee `RelationSelect` pointed at `/api/user` (singular) but the
  User routes are pluralized `/api/users`, so the dropdown 404'd silently → fixed to `/api/users`
  (root cause `scripts/scaffold-entity.mjs` assumes singular-kebab target routes — logged as the
  scheduled follow-up below). **Medium** — duplicate `assetTag` POST threw an unhandled P2002 500 →
  added a `findUnique` pre-check returning a clean 409 (mirrors `app/api/users/route.ts`). **Medium**
  — `status`/`category` DataTable column filters were dead controls (DataTable runs
  `manualFiltering`, no `onFilterChange` wired, GET took no such param) → wired `onFilterChange` +
  the `where` clauses. **Low** — blueprint AC-4.1 said "422" but `err()` defaults to 400 app-wide →
  blueprint corrected to 400.
- 2026-07-17 — [harness-v2 V2-210/scaffold] `scripts/scaffold-entity.mjs` emits a relation-picker
  `path="/api/<targetKebab>"` assuming every target model's routes are singular-kebab; that holds for
  scaffolded entities but not for hand-built pluralized routes (`User` → `/api/users`), so a
  generated `RelationSelect` to such a target 404s — owner: operator — status: fixed(repo-audit) (the
  generator now PROBES the filesystem for each relation target's real route — `app/api/<kebab>/route.ts`
  then the pluralized `.../<kebab>s/route.ts` — and wires `RelationSelect` to whichever exists, warning
  loudly and defaulting to the singular path when neither is found. Discovered via the V2-210 pilot).

- 2026-07-17 — [harness-v2 V2-301/design] visual-iteration critique of the Asset Tracker surfaced
  UI polish beyond the one fix taken this pass (raw-enum humanization, fixed via
  `components/asset/asset-labels.ts`) — owner: operator — status: scheduled: (a) the list/detail
  **breadcrumb shows the raw route segment `asset`** (lowercase) instead of a label like "Assets" —
  a route-segment humanization in the shared breadcrumb; (b) the enum-humanization should be
  **scaffold-emitted** (`scripts/scaffold-entity.mjs` should generate a label map per enum so every
  future entity gets it) and eventually flow through **next-intl messages** (V2-305 copy chokepoint)
  rather than a per-feature map. Low urgency; captured in `docs/verification/asset-tracker/NOTES.md`.

- 2026-07-17 — [harness-v2 V2-307/design] first scored `/design-qa` run (Asset Tracker list,
  `docs/design-references.md`) scored 8/9 — the one deduction: **two competing "New Asset" primary
  CTAs** (top-right toolbar + empty-state center), violating "one primary action per screen"
  (criterion 3, anchored to Linear/Stripe) — owner: operator — status: fixed(repo-audit) (resolved
  the way the note proposed: `components/shared/EmptyState.tsx` gained an optional
  `actionVariant?: "default" | "outline"` (default preserves every other caller), and the Asset list's
  empty state now passes `"outline"` so the always-visible PageHeader button is the single visual
  primary. Type/lint/build-clean. NOTE: pixel confirmation via the V2-301 capture loop is delegated to
  a DB-capable env — this container has no DB/app to run `npm run capture` (see the visual-QA infra
  wave-off below). Propagating `actionVariant` into `scaffold-entity`'s list template is a follow-up).

## Standing wave-offs promoted to documented trade-offs

<!--
When a wave-off is a permanent, intentional design choice (not a deferral), it
graduates out of the live register into a documented "known trap" in CLAUDE.md or
an ADR — then delete its line above. These are the already-documented ones, kept
here as pointers so they aren't re-litigated as new findings:
-->

- File uploads not wired; PDF export intentionally absent from `lib/export.ts` (ADR-006).
- Rate limiter is in-memory per-instance (fine single-instance; Upstash via `/scale-up`).
- CSP allows `'unsafe-inline'` script+style (AntD SSR + Next bootstrap).
  (See CLAUDE.md "Known traps" for the full list.)
- 2026-07-17 — [debt sunset, V2-409] **AntD type-shim** (`components/shared/table-types.ts`): a
  transitional AntD-shaped `Table`/`Column` type surface kept so the rebuilt `DataTable`/`DataView`
  authoring shape survived the AntD removal (ADR-029, C4). SUNSET: re-author columns directly against
  @tanstack/react-table `ColumnDef` at the next `DataTable` refactor; remove when
  `git grep "@/components/shared/table-types"` is empty. Annotated in the file header.
- 2026-07-17 — [debt sunset, V2-409] **bcryptjs** (`lib/password.ts`): kept ONLY to verify legacy
  `$2*` hashes and auto-upgrade them to Argon2id on next login (new hashes are never bcrypt). SUNSET
  condition: no `$2*` hashes remain for 90 days — count with
  `SELECT count(*) FROM "users" WHERE "passwordHash" LIKE '$2%';` (verified = 0 in the seeded DB
  2026-07-17); when durably 0, delete the bcrypt branch + `npm uninstall bcryptjs`. Annotated in
  `lib/password.ts`.
- 2026-07-17 — [awareness, V2-405] **`qs` moderate advisory (dev-only)**: adopting
  `@stryker-mutator/core` (V2-405) pulled a transitive `qs` (via `typed-rest-client`) carrying a
  **Moderate** DoS advisory (GHSA — below `/ship`'s High+ npm-audit gate, so it does not red). Dev/
  mutation-testing tooling only, never in the runtime bundle. Awareness line, not a wave-off; clears
  when the upstream chain bumps `qs`. (Surfaced by the senior review; noted per its recommendation.)
- 2026-07-17 — [env constraint, V2-401/ADR-061] **testcontainers container-run acceptance**: the
  `ship:full` integration gate provisions an ephemeral `pgvector/pgvector:pg16` container via
  `@testcontainers/postgresql` when a Docker daemon is present. THIS build container has no daemon,
  so the container path was verified by construction + the honest-skip path, while the actual suite
  round-trips were verified against the persisted **native Postgres 16 + pgvector** DB
  (`scripts/test-integration.mjs` path 1, 6/6). The container bring-up itself is "verified where
  Docker present" (CI / a dev box with a daemon) — same degrade-to-WARN posture as the ADR-030
  docker-image gate; not a deferral, an environmental constraint.
