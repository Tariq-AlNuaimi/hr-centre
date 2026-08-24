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

- 2026-08-24 — [harness/gates] **`qa-gate` (and its sibling receipt gates) evaluate
  `CLAUDE_PROJECT_DIR`'s HEAD, not the HEAD of the repository actually being deployed.**
  `.claude/hooks/qa-gate.mjs:59` resolves `const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`.
  When a session's primary working directory is one repo and the deploy is run from a second
  checkout — the exact shape of `/first-fork`, and of this product being forked out of the
  template — the gate reads the WRONG repository. Observed here: `npm run deploy` from
  `rihal-performance-management` (HEAD `8b5b90b`) was denied citing HEAD `4fcfee9`, which is the
  template fork's HEAD. This is a **fail-closed** miss in the safe direction (it denied rather
  than allowed), but the failure mode in the other direction is the dangerous one: a receipt
  trailer sitting on the primary dir's HEAD would SATISFY the gate for a deploy of an entirely
  different, unreviewed repository. The receipt is also content-bound to a tree-sha, so a
  cross-repo receipt would be checking one repo's tree against another repo's gate.
  **Interim handling in this session:** the deploy is invoked with `CLAUDE_PROJECT_DIR` set to the
  repository being deployed, which makes the gate evaluate the correct — and, at that point,
  receipt-less — HEAD rather than a stale unrelated one. That is a correction of a wrong value,
  not a bypass: the gate still runs and still demands a receipt or a recorded skip at that HEAD.
  **Fix owed:** derive ROOT from the git toplevel of the invoking cwd (`git rev-parse
--show-toplevel`) and fall back to `CLAUDE_PROJECT_DIR` only when that fails; audit
  `review-gate.mjs`, `blueprint-gate.mjs`, `build-vs-buy-gate.mjs` and `bash-write-gate.mjs` for
  the same line. — Tariq Al-Naaimi — status: adjudicated(2026-08-24), fix SCHEDULED in the
  template repo, not here. **Why not fixed now:** the hook that misbehaves is loaded by the
  harness from `CLAUDE_PROJECT_DIR`, so patching this fork's copy would not change the behaviour
  of the session that hit it — the fix has to land in `Tariq-AlNuaimi/fullstack-vibe-template`'s
  `.claude/hooks/`, which is the template's harness surface and deserves a deliberate change with
  its own tests, not a rider on a product deploy. **Risk accepted in the interim:** the observed
  direction is fail-closed. The dangerous direction requires a receipt trailer to exist on an
  unrelated repo's HEAD at the moment of a deploy, and the deploy is operator-invoked, so it is
  not reachable without a person running one.

- 2026-08-24 — [quality/QA] **PMS Phase 1 deployed without a `/qa` receipt — `Gate-Skip: qa-gate`.**
  The three-tier orchestrator (design QA → functional QA → UAT) was NOT run. What WAS run, and is
  recorded with results in `docs/verification/pms-phase1/README.md`: the migration applied to a
  real PostgreSQL 16 database; 12/12 database invariants exercised by actual INSERT/UPDATE; the
  recursive-CTE chain walk on seeded data (depth 3, no cross-entity leakage); the import pipeline
  end-to-end including the §3.5 truncated-export case (2-of-36 file → 1 joiner, 0 deletions) and
  all seven §3.4 rejection rules; the full §4 permission matrix asserted on **live API payloads**
  for five roles (the line manager's response carries 8 rows and no `basicSalary` key at all); and
  four screenshots of the built screens including dark mode. Three real defects were caught and
  fixed this way (Excel writer seam returning a handle not a Buffer; the generated template's own
  `Manager (Employee ID)` header failing to parse; a malformed JSON body returning 500 not 400).
  **WHY waived:** the remaining `/qa` gap is a formal **axe accessibility audit** and a UAT
  report. Running design-QA's axe tier meaningfully wants a deployed URL, and this is a
  first deploy — the gate is circular at this point in the chain. The functional substance
  `/qa` would have covered was covered by hand and is evidenced above; what is genuinely
  untested is a11y. **NOT waived, scheduled:** run `/design-qa` (axe) against the deployed URL
  as the first action after the deploy lands, before HR review. — Tariq Al-Naaimi
  (operator chose this path explicitly when offered the alternative of running the full `/qa`
  first) — status: adjudicated(2026-08-24), with the axe run scheduled as the first post-deploy
  action

- 2026-08-21 — [secure/harness] **Round 12: the re-review found the FIFTH instance of the
  pattern, plus four more.** A second senior pass was commissioned specifically to hunt for a
  same-class gap introduced BY the round-11 fixes. It found five, all execution-verified. The
  pattern is now established beyond doubt: **each fix keyed off the SYNTACTIC SHAPE of the
  previous proof-of-concept rather than the SEMANTIC property it needed to enforce.**
  - **CRITICAL — `cat .{a..z}nv` read the live env file.** Round 11's brace fix split on commas.
    Bash's RANGE form has no comma, so the single "alternative" was the literal `a..z` and the
    secret name was never produced. Fixed by expanding alphabetic and numeric ranges.
  - **HIGH — both brace bounds FAILED OPEN.** Past depth 6 the unexpanded string was returned
    as if checked; past the alternative cap the remainder was silently dropped. Deep-nested and
    71-item payloads both walked through. A bound on a fail-closed guard must DENY what it
    cannot evaluate; `expandBraces` now reports completeness and an incomplete expansion denies.
  - **HIGH — a heredoc piped to an interpreter bypassed the write gate.** Round 11 read the
    interpreter from the opening line's FIRST word, so it recognised the direct form and nothing
    else; piping the same body into a shell has a different first word. Now the whole pipeline
    is examined.
  - **MEDIUM-HIGH — keeping an executed body resurrected the original false positive.** The body
    was copied verbatim, sweeping a nested DATA heredoc's content back into the scanned text —
    the precise bug `stripHeredocBodies` exists to prevent. Now recursive.
  - **MEDIUM-HIGH — a NEW false-positive denial on ordinary work.** Unifying the runner list put
    `sh`/`bash`/`zsh` into a whole-command regex OR'd against a separate removal-call regex, so
    a grep for a removal call followed by an unrelated strict-mode script run was hard-denied:
    the grep pattern supplied the removal text, the script run supplied the runner. On a guard
    with no tiering and no override. The destructive scan is now bound to the runner's quoted
    inline BODY, which is what the whole-command check was for in the first place.
    The reviewer also confirmed the `ship.mjs` accumulator fix as the one solidly-scoped repair of
    the four. **What this says about the method:** every round so far was caught by an independent
    pass, never by the author, and each round's fix was verified against its own PoC and shipped
    green. Regression tests are necessary and have not been sufficient — the tests encode the
    known shape, and the next gap is always the unknown one.
    — owner: operator — status: fixed(guard-probe 31+36+48 all clear; 77 hook tests; evidence
    `tests/harness/guard-probe.mjs`, `tests/harness/hooks.test.mjs`)

- 2026-08-21 — [secure/harness] **Four guard defects introduced by this session's own
  hardening, found by senior review, all fixed.** Recorded because two were CRITICAL bypasses
  of what CLAUDE.md calls the security floor and they existed on `main` for part of the day; a
  fork auditing these guards deserves the history, not just the fixed end state. The review's
  diagnosis is the durable part: **each hardening pass closed the specific gap its commit
  message named while reintroducing the same CLASS of gap one level over.**
  - **CRITICAL — brace expansion defeated `protect-secrets` entirely.** `cat .{e,x}nv` read
    `.env`. Brace expansion is a separate, EARLIER shell stage than globbing, and the rewritten
    glob check only looked for `*?[]`; the token was neither a glob nor the literal `.env`.
    Every caller funnels through `secretPath()`, so the archive/copy/curl/interpreter checks
    fell with it. Fixed by EXPANDING braces and checking each alternative — not by banning `{`,
    since `cat file.{ts,tsx}` is ordinary work and over-blocking a fail-closed guard is its own
    harm.
  - **CRITICAL — the two interpreter lists in `dangerous-commands` had diverged.** Round 8
    widened the per-segment `Set` with bun/npx/tsx/ts-node/sh/bash/zsh and left the
    whole-command regex untouched. That regex exists because the segment splitter is not quote
    aware, so a destructive call after a `;` was caught by neither. `node -e` with the identical
    body WAS denied, which is how it hid. Fixed by deriving both from one list — the duplication
    was the defect.
  - **HIGH — `bash-write-gate` heredoc stripping swallowed real writes.** The round-8 fix for a
    real false positive assumed heredoc bodies are inert data; for `bash <<'OUTER'` the body is
    a script, so a nested write to a new gated route was invisible. Now scanned when the opener
    is an interpreter, still stripped for data sinks.
  - **HIGH — `/ship`'s verdict counted silent skips as "ran".** Twelve early-returns said "I
    checked nothing" only in `out`, so they printed under `ran (N)`. Two are enforcement-quartet
    gates whose skip path is the normal state of a shallow clone. The first fix sniffed `out`
    and mislabelled `contract tests` as degraded — the mirror-image error, reverted. Every skip
    path now sets `warn`, guarded by a static invariant test, **which then found two more skip
    paths the review had not listed**.
    — owner: operator — status: fixed(see PR #116; evidence `tests/harness/guard-probe.mjs`,
    `tests/harness/hooks.test.mjs`, `tests/harness/ship-gates.test.mjs`)

- 2026-08-21 — [secure/harness] **The review's three UNCERTAIN items, settled by execution.**
  The reviewer rated these 55–65 and could not confirm them; all three were checked rather than
  left as folklore.
  - **CONFIRMED and fixed — `git push --all` / `--mirror` bypassed the protected-branch check.**
    Both push every branch, `main` included, without ever naming it, so a check that inspects
    ref tokens never saw them. Verified allowed beforehand, denied after.
  - **DISMISSED, deliberately — the case-sensitive `main`/`master` match is CORRECT.** Git
    branch names are case-sensitive, so `Main` is a different branch and pushing to it does not
    touch `main`. Denying it would add a false positive to a fail-closed guard. A repo whose
    default branch is literally `Main` would be unprotected; that is not this repo, and the
    fix would be to name the branch in the check rather than to match case-insensitively. A
    probe case records the dismissal so it is not re-raised as a bug.
  - **CONFIRMED and fixed — `retryAfter` reported the wrong reset when both buckets denied.**
    `rateLimit` returned the IP bucket's value whenever both denied, so a caller who waited
    exactly that long was still refused by the subject bucket — a `Retry-After` header that
    sends the client into a second 429. The two buckets share `windowMs` but not their start
    times (the subject bucket accumulates across IPs, which is the case it exists for). Now the
    later of the two. Correctness/UX, not a security gap: the denial itself always held.
    — owner: operator — status: fixed(tree evidence: `.claude/hooks/dangerous-commands.mjs`
    `--all`/`--mirror` branch, `lib/rate-limit.ts` `Math.max` on retryAfter)

- 2026-08-21 — [scalable/ops] **Docker base image + otel collector bumps — merged unverified,
  now verified and CLOSED.** #106 landed the node base image at `24.19.0` (was 24.18.0,
  `Dockerfile`) and `otel/opentelemetry-collector-contrib` at `0.159.0` (was 0.156.0,
  `compose.prod.yaml`) without either being exercised, because `ship:full` never reached the
  gates that would cover them. Two successive "this cannot run here" claims turned out to be
  "nobody tried":
  - **The DB gates.** `db-structure` and `integration` were assumed to need Docker. The web
    container ships a real PostgreSQL 16 natively (recipe in `docs/agent-memory.md`), and
    `scripts/test-integration.mjs` resolves a reachable `DATABASE_URL` FIRST — a native-Postgres
    path written for exactly this and never used. `integration` now runs 6 tests, 0 skipped.
  - **The docker gate.** Assumed unavailable; the daemon had simply never been STARTED. `dockerd`
    comes up fine (29.3.1). The gate then ran for real and went RED on `SELF_SIGNED_CERT_IN_CHAIN`
    — the build container not trusting the agent proxy's CA, i.e. environmental, not a defect.
    With the CA injected via a build-context mount (no tracked file changed), the risk this entry
    named — "a base image bump can change the glibc/OpenSSL under Prisma's engines" — is disproven:
    **glibc identical** (`2.36-9+deb12u14`), **OpenSSL identical** (`3.5.7`), and the native-module
    rebuild **succeeds** on 24.19.0 (`npm ci && npm rebuild @prisma/engines @sentry/cli sharp
@swc/core esbuild unrs-resolver @parcel/watcher` → DONE 46.5s, then `prisma generate` → DONE
    22.5s). Both collector images pull.
    The last gap was the final image assembly: `npm run build` inside the container failed on
    `next/font` reaching `fonts.googleapis.com`. **The operator's read was the right one** — that is
    not a sandbox artifact to work around, it is a real BUILD-TIME network dependency that every
    air-gapped, proxied or offline build hits. `next/font/google` is self-hosted at RUNTIME but
    fetches font files at BUILD time; the code comment asserted the former and was silent on the
    latter, which is why it went unnoticed. Replaced with `next/font/local` over two variable
    `.woff2` files vendored into `app/fonts/` (from the official `geist` package, SIL OFL 1.1; the
    package itself is NOT a dependency — two static assets do not need one). Verified: `npm run
build` succeeds with `HTTPS_PROXY` unset, and the **full Docker image builds end to end (exit 0)** on the node 24.19.0 base, with both fonts baked in as hashed static assets and the image
    running. — owner: operator — status: fixed(tree evidence: `app/fonts/*.woff2` +
    `app/[locale]/layout.tsx` using `next/font/local`)

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
  redirect text in Bash commands. — owner: operator — **status: fixed(2026-08-21)** — heredoc
  BODIES are now stripped before anything scans for writes (the opener still redirects and is
  still gated), and the redirection scan is quote-aware, so a `>` inside a quoted string is text
  rather than a redirect. The feared "real parser work" turned out to be a small line-wise
  heredoc strip plus a character scanner that tracks quote state — no shell grammar needed.
  Regression tests in `tests/harness/hooks.test.mjs`, verified to FAIL against the pre-fix hook.

- 2026-07-16 — [harness-v2 V2-001/secure] `bash-write-gate.mjs` is evadable by writes that avoid a
  literal `>`/`tee`/`cp`/`sed -i` token: a shell variable holding the path (`F=…; cat > "$F" …`) or
  an interpreter one-liner (`node -e "fs.writeFileSync('app/api/x/route.ts',…)"`) creates a new
  uncovered gated file without tripping the gate (senior-review 2026-07-16, confidence 88). WHY not
  fixed now: the hook is best-effort by design (its header says so) and the Write-tool gates still
  catch the normal path; closing these needs variable-tracking / interpreter-verb heuristics. —
  owner: operator — **status: fixed(2026-08-21)** — both spellings close. Literal single-line
  `VAR=value` assignments are collected and `$VAR` / `${VAR}` expanded in every candidate target,
  so `F=app/api/x/route.ts; cat > "$F"` resolves. Interpreter one-liners are scanned for path-shaped
  string literals, but ONLY when the body also contains a write call (`writeFileSync`,
  `appendFileSync`, `createWriteStream`, `write_text`, …) — that condition is what keeps a one-liner
  which merely READS a gated path from being denied, and it has its own counter-case test. Still
  deliberately not a shell: multi-line or computed assignments are out of scope, and the hook stays
  fail-OPEN. Regression tests verified to FAIL against the pre-fix hook.

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
