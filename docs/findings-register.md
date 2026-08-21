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

> **Resolved history lives in [`docs/archive/findings-register-2026.md`](archive/findings-register-2026.md)**
> (archived 2026-08-17). This file carries only entries that are still unresolved or conditionally
> re-openable, plus the standing trade-offs below. Nothing was deleted — 40 resolved entries
> (`status: fixed(...)` / `status: adjudicated(...)` with no pending work) moved to the archive so
> the live register stays readable. `/ship`'s `wave-offs` gate parses THIS file only.

## Register

<!-- newest first -->

- 2026-08-21 — [scalable/ops] **Docker base image + otel collector merged UNVERIFIED.** #106 landed
  the node base image at `24.19.0` (was 24.18.0, `Dockerfile`) and
  `otel/opentelemetry-collector-contrib` at `0.159.0` (was 0.156.0, `compose.prod.yaml`). Neither
  was exercised. First because `ship:full` was RED at phase A (knip) and never reached phase B; then,
  once phase A went green, because **the phase-B gates that would cover them SKIP rather than fail
  without a Docker daemon** — `docker` degrades to a WARN by ADR-030 ("never a false RED"). So a
  green `ship:full` on a machine without Docker does **not** mean the image builds; it means nobody
  asked. That is the correct design — a false RED trains people to ignore the gate — but it does
  mean the green is narrower than it reads.
  **Largely verified 2026-08-21 (second pass).** The claim that Docker "cannot run here" was
  itself unverified — the daemon had never been STARTED. `dockerd` comes up fine (29.3.1,
  overlayfs), the gate then ran for real (117.6s) and went RED, and the RED turned out to be
  environmental: `SELF_SIGNED_CERT_IN_CHAIN`, because npm inside the build container does not
  trust the agent proxy's CA. Re-run with the CA injected via a build-context mount (no tracked
  file changed), the evidence on the actual risk is:
  - **glibc identical** across the bump — `2.36-9+deb12u14` on both 24.18.0 and 24.19.0.
  - **OpenSSL identical** — `3.5.7` on both.
  - **The native-module rebuild SUCCEEDS on 24.19.0**: `[deps 6/6] RUN npm ci && npm rebuild
@prisma/engines @sentry/cli sharp @swc/core esbuild unrs-resolver @parcel/watcher` → DONE
    46.5s, followed by `prisma generate` → DONE 22.5s. That step _is_ the risk this entry named.
  - **Both collector images pull** — `otel/opentelemetry-collector-contrib` 0.156.0 and 0.159.0.
    Still not proven: the final image assembly. `npm run build` inside the container fails on
    `next/font` reaching `fonts.googleapis.com` — egress again, and the same step is green on the
    host (`ship`'s `build` gate). Closing that needed `docker build --network=host`, which the
    sandbox's permission classifier denied; not worked around. **So: the named risk is disproven and
    the entry can most likely be closed, but one CI or /deploy image build should confirm it.**

  **Narrowed 2026-08-21:** the `integration` half is now genuinely covered. That gate also used to
  skip here, but only because nobody had tried the native-Postgres path it resolves FIRST; the web
  container turns out to ship a real PostgreSQL 16 (see `docs/agent-memory.md`), so it now runs 6
  tests with 0 skipped. **What is left is strictly the Docker image itself** — the `Dockerfile`
  base image and the collector sidecar — which needs the daemon and nothing else will substitute. Risk is low (patch/minor bumps to a SHA-era pinned base image and a sidecar that
  is inert unless the observability profile is up) but it is not zero and it is not measured: a base
  image bump can change the glibc/OpenSSL under Prisma's engines, which is exactly the class of
  break a build would catch and a unit test would not. **What closes this:** one `npm run ship:full`
  on a machine with a Docker daemon, reaching phase B green — or the first successful `/docker`
  build or self-host deploy, whichever comes first. Recorded rather than fixed because the
  operator merged the bumps deliberately after being told they were unverified. — owner: operator —
  status: adjudicated(2026-08-21) (accepted: verify at the next ship:full-with-Docker or /deploy)

- 2026-08-17 — [security/harness] `.claude/settings.json` `permissions.allow`/`deny` narrowed
  (red-team R2) — CLAUDE.md requires a register note for any change to the permission arrays. This
  change **narrows** capability rather than widening it: `Bash(npx prisma *)` → verb-scoped
  (`generate`, `migrate dev|deploy|status`, `studio`, `db seed`); `Bash(find . *)` → read-only forms;
  `Bash(git push *)` → `claude/*` refspecs; `Bash(docker compose down*)` → no flags. Destructive
  verbs (`migrate reset`, `db execute`, `db push`, `find -delete/-exec`, `down -v`, pushes to `main`,
  `shred`) moved to deny. **Residual risk accepted:** deny patterns are prefix-lexical and therefore
  evadable by spelling; `dangerous-commands.mjs` is the semantic backstop (R2b) and
  `tests/harness/guard-probe.mjs` proves both layers. **Operator-approved** — see
  `docs/AUDIT-DECISIONS.md` Phase 1 R2 — Tariq Al-Naaimi — status: fixed(see branch
  `claude/security-phase1`; evidence `tests/harness/guard-probe.mjs`)

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
- 2026-07-17 — [debt sunset, V2-409] **AntD type-shim** (`components/shared/table-types.ts`) —
  ✅ **CLOSED WON'T-DO 2026-07-25** (operator decision; OPEN-ITEMS item 13). Was listed as
  transitional debt to retire "at the next DataTable refactor". Retirement was measured before
  being attempted: a 605-line AntD→`ColumnDef` conversion core plus **11** column-authoring sites
  re-authored, plus ~10 list screens visually re-verified under the binding V2-301 loop — for zero
  user-visible change, on a surface that works. **Reclassified from debt to a deliberate
  abstraction**; the file header now says so. Not deferred — deferral would keep re-surfacing it.
  If `DataTable` is ever rewritten for a real reason, the shim goes with it as a side effect.
- 2026-07-17 — [debt sunset, V2-409] **bcryptjs** (`lib/password.ts`) — ✅ **SUNSET COMPLETED
  2026-07-25** (OPEN-ITEMS item 12). Was kept ONLY to verify legacy `$2*` hashes and auto-upgrade
  them to Argon2id on next login. The stated condition was "0 legacy hashes for 90 days"; the
  **0 was verified** (`SELECT count(*) … LIKE '$2%'` = 0 against the seeded DB, 2026-07-25) but the
  **90-day durability half could NOT be** — this container has no long-lived deployment to observe.
  The operator was shown that gap explicitly and chose to remove now anyway; recorded here so the
  waived half is not silent. Removed: the import + the bcrypt branch in `verifyPassword`,
  `npm uninstall bcryptjs`, and the legacy-accepts test INVERTED to assert rejection.
  **Consequence, deliberately accepted:** Argon2id is now the only supported algorithm, so a
  pre-ADR-039 fork whose users have not logged in since the migration will find those logins
  failing — recoverable only via the password-reset flow (no data loss). A fresh fork only ever
  writes Argon2id, so this is a no-op for anything created from the template. The caveat is
  documented at the top of `lib/password.ts` for anyone running `/sync-from-template`.
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
