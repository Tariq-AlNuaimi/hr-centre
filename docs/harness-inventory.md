# Harness Inventory & Enforcement Audit

_Complete catalog of everything this template ships — each entry is **what it does · why it exists · how it could be better** — judged through one lens: **is it enforced, or merely advised?**_

> Generated 2026-07-10 by a read-heavy audit (parallel scout agents per category, senior-reviewer synthesis). This is a critical inventory, not a brochure: every entry names a real gap. Where a prior session's note was stale, it is corrected inline and flagged **[correction]**.

## The lens

The operator's core complaint that produced the current enforcement layer: **the template defaulted to hand-building, over-complicating, and skipping planning because those behaviors were advisory prose (CLAUDE.md), not gates.** So the organizing question for every item below is:

- **ENFORCED** — a hook denies, or `/ship` goes RED, or an ESLint rule errors. The machine stops you.
- **ADVISORY** — a suggestion, a printed warning, a skill you must remember to invoke. Discipline, not enforcement.

The headline finding is at the end (§11): the three new gates (ADR-032/033/034) successfully convert three advisory behaviors into checkpoints — but **every one enforces the _checkpoint_, not the _substance_**, and **every guard hook is fail-open**. The enforcement layer is real and worth having; it is also thinner than it looks.

---

## §0 — Enforcement scorecard (the one-screen read)

| Category      | Count | Enforced (blocks)                                  | Advisory (suggests)                                        |
| ------------- | ----- | -------------------------------------------------- | ---------------------------------------------------------- |
| MCP servers   | 4     | —                                                  | all 4 (capabilities, not gates)                            |
| Agents        | 2     | senior-review is _expected_ post-push (CI dormant) | scout is on-demand                                         |
| Skills        | 26    | ~7 have a hard gate inside them                    | ~19 are invoke-when-you-remember                           |
| Hooks         | 15    | 6 hard-block · 1 fails-closed                      | 9 advisory; **fail-open on error (except `session-stop`)** |
| `/ship` gates | 18    | 14 hard-fail                                       | 4 skip-if-tool-absent (knip, jscpd, coverage, size-limit)  |
| ESLint rules  | 13    | all 13 at `error`                                  | — (but all miss reflective/dynamic forms)                  |
| ADRs          | 34    | 4 are enforcement gates (030/031/032/033/034)      | rest are decisions of record                               |

**Load-bearing enforcement is concentrated in ~5 hooks, ~14 ship gates, and 13 lint rules.** Everything else is culture.

---

## §1 — Tech stack (ADR-001 locked; ADR-029 replatformed the UI)

The stack is a _decision of record_, changeable only via a superseding ADR — that lock is itself an enforcement mechanism (you can't casually swap Prisma for Drizzle).

| Layer         | Component                       | Version                | What / why it exists                                                                       | How it could be better                                                                                               |
| ------------- | ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js                         | 16.2.10                | App Router + RSC; pinned exact (16.2.10 builds clean around upstream #85668/#86178).       | Pinned-exact means security patches need a manual bump; ADR-017 currency policy is advisory, not gated.              |
|               | React                           | 19.2.5                 | Server components default.                                                                 | —                                                                                                                    |
|               | TypeScript                      | 5 (strict)             | Types are the first gate (`/ship` typecheck).                                              | —                                                                                                                    |
| ORM           | Prisma                          | 7.7.0                  | Schema is the source of truth; audit + soft-delete extensions ride on it.                  | Extensions are opt-in per model — a hand-added model that forgets `registerSoftDeleteModel` silently hard-deletes.   |
| DB            | Postgres                        | 17 (Neon)              | Free tier = no backups; PITR needs Neon Launch ($19/mo).                                   | No backup on the free tier is a real data-durability gap for anything past a prototype.                              |
| Auth          | Auth.js                         | 5.0.0-beta.31          | Credentials + optional Entra ID SSO; JWT sessions.                                         | On a **beta** release for the auth core — a real supply-chain/stability risk to name. No password-complexity policy. |
| UI            | Tailwind v4 + shadcn/ui (Radix) | 4.3.2 / latest         | ADR-029 replatformed off Ant Design; primitives in `components/shared/*`.                  | Radix/recharts emit inline `style=` → CSP keeps `style-src 'unsafe-inline'` (documented, unavoidable).               |
|               | Tremor                          | _named, not installed_ | ADR-029 names Tremor for charts; **recharts 2.15.4 is what actually ships.**               | **[gap]** ADR-029 lists a dep that isn't in `package.json` — doc/stack drift.                                        |
| i18n          | next-intl                       | 4.13.1                 | Config-driven `en`/`ar` (RTL auto). Ships English-only; Arabic inert until a fork opts in. | —                                                                                                                    |
| Client data   | TanStack Query/Table            | 5.101 / 8.21           | Client cache + headless tables (ADR-021).                                                  | —                                                                                                                    |
| Validation    | zod                             | 3.25.76                | Boundary validation on every route.                                                        | Per-route copy-paste; many entities lack a dedicated `lib/validations/*` file.                                       |
| Charts        | recharts                        | 2.15.4                 | SVG charts.                                                                                | See Tremor drift above.                                                                                              |
| Export        | ExcelJS                         | 4.4.0                  | XLSX with formula-injection neutralization.                                                | **PDF intentionally absent** (pdfkit fragile in serverless) — sidecar recipe only.                                   |
| Email         | nodemailer                      | 9.0.1                  | SMTP; **disabled by default** (`SMTP_HOST` unset → `{sent:false}`, no throw).              | No retry, no templating, no bounce handling.                                                                         |
| Observability | @sentry/nextjs                  | 10.63.0                | Error + perf, opt-in via DSN; user ID only, no PII.                                        | Error/perf only — no distributed tracing.                                                                            |

**Intentionally absent** (each has a `/scale-up` recipe): file uploads, background jobs, realtime, distributed rate-limit, column encryption, PDF export.

---

## §2 — MCP servers (`.mcp.json`)

Four servers, all live (no per-server enablement gate in `settings.json`). These add **capabilities**, never enforcement.

### playwright — `npx @playwright/mcp@0.0.76 --isolated --browser chromium`

- **What:** Browser automation — navigate, screenshot, fill forms, assert.
- **Why:** The engine under `/design-qa`, `/uat`, `/manual-uat`. Without it those QA tiers can't run.
- **Better:** No auth-session injection — every run re-walks the login flow. Relies on the pre-installed Chromium at `/opt/pw-browsers`; fails opaquely if that binary moves.

### context7 — `npx @upstash/context7-mcp`

- **What:** Fetches live library/framework docs (Next, Prisma, Tailwind…) so answers aren't from stale training data.
- **Why:** The locked stack moves; version-correct docs prevent wrong-API guesses.
- **Better:** No local cache — every lookup hits the network; silently useless if egress is blocked.

### shadcn — `npx shadcn@latest mcp`

- **What:** Add/update/list shadcn/ui components.
- **Why:** **[correction]** A prior note called this "orphaned because the template uses Ant Design." That is stale — ADR-029/030 **replatformed off Ant Design onto Tailwind + shadcn/Radix**, and this server was wired _this integration session_ precisely because forks now build on shadcn. It is correctly matched to the current stack.
- **Better:** `@latest` is unpinned — a shadcn CLI major could change behavior mid-session (contrast the pinned playwright `@0.0.76`). Overlaps conceptually with the `/design-system` skill's hand-curated primitives; the boundary ("when do I use the MCP vs. the vetted recipe?") isn't documented.

### chrome-devtools — `npx chrome-devtools-mcp@latest --executablePath /opt/pw-browsers/chromium`

- **What:** Chrome DevTools Protocol — perf profiling, network waterfalls, live DOM/JS.
- **Why:** Added this session for performance debugging / the `/scale-up` performance-measurement recipes.
- **Better:** **[real gap]** Not wired to any skill yet — speculative capacity. Overlaps with playwright at a lower level with no documented separation of concerns. `@latest` unpinned. This is the weakest-justified server; either wire it into a perf skill or drop it.

---

## §3 — Agents (`.claude/agents/`) + built-in subagent types

### scout (haiku · Read/Grep/Glob)

- **What:** Cheap, read-only investigator — "where is X", "how does Y work", orientation passes. Returns condensed reports, never edits.
- **Why:** Token thrift (ADR-019/022). Repo-wide reads in the main window cost 10–100×; scout burns cheap haiku tokens in isolation and returns only the conclusion. **This inventory was built with five of them.**
- **Better:** Haiku is shallow for judgment — it produced two stale/wrong claims this very session (shadcn "orphaned", gitleaks "uninstallable"). It's a fact-gatherer, not an analyst; the synthesis must be done by a stronger model, which the token-policy assumes but doesn't enforce. Can't verify findings by running anything.

### senior-code-reviewer (sonnet · Read/Grep/Glob/Bash)

- **What:** Post-push breadth review — five lenses (correctness → security → invariant → operational → architecture), forced execution traces on high-risk paths, reports only ≥80-confidence findings.
- **Why:** Layers on top of the pre-push `/code-review` diff gate (ADR-020). Owns what a diff can't see: cross-cutting invariant completeness, output-side trust boundaries, time-varying drift.
- **Better:** **Its enforcement is aspirational.** CLAUDE.md says it "runs after every push," but CI (`senior-review.yml`) is dormant until `ANTHROPIC_API_KEY` + triggers are set, so today it fires only if someone _remembers_ to invoke it. The ≥80 confidence filter can silently drop borderline-but-real findings. Read-only — produces reports the operator must action; no `--fix` path.

### Built-in subagent types (part of the harness story, not `.md` files)

- **Explore / Plan / general-purpose** — host-provided agents used for fan-out search and design.
- **`EnterPlanMode`** — invoked inline by the main session (not a subagent) for high-blast-radius/ambiguous work; pairs with `/blueprint` as the requirements half. Plan-writing consumes main-session tokens (intentional: plans are rare and deserve senior attention).

**Verdict:** The agent tier is lean and fit. The gap is that the _reviewer_ — the one agent meant to be automatic — isn't, until CI is funded.

---

## §4 — Skills (`.claude/skills/`, 26)

Grouped by lifecycle role. "Gate" = the skill contains a hard stop; "advisory" = you must remember to invoke it. **No skill is auto-invoked by a hook** — `skill-activation.mjs` only _suggests_ them.

### Lifecycle (onboarding → exit)

- **/first-fork** — _advisory._ Guides a non-dev through Vercel+Neon signup to first URL. **Better:** no guard against running it on a raw un-forked clone.
- **/new-project** — _advisory._ One command → repo + Neon + Vercel + optional Cloudflare domain in ~3 min. **Better:** if egress is blocked on a web session the operator is stranded with no "run from your laptop" fallback surfaced.
- **/rebrand** — _advisory._ Sweeps template identity strings → fork identity. **Better:** claims idempotency but gives no evidence it already ran (twice = "no changes" with no explanation).
- **/handoff** — **gate** (refuses unless `tier: shared`). Produces HANDOFF.md (state, env, schema, routes, run-locally) for the IT team. **Better:** missing-reference-file preflight only _warns_ — hands over a stale doc with silently-omitted sections.
- **/handoff-session** — _advisory._ Freezes in-flight state to branch-scoped `SESSION-HANDOFF.md`, promotes durable knowledge to `agent-memory.md`. **Better:** push-landed verification is manual; a silent push failure erases the whole carrier.

### QA & testing (gated tiers)

- **/design-system** — _advisory._ Proactive front-half: declare the design read, build from vetted recipes on shipped primitives. **Better:** nothing _proves_ the recipe was checked — ignore `PageHeader` and `/design-qa` catches it later, not earlier.
- **/design-qa** — **gate** (Tier 1: build-green + running app entry; no serious/critical a11y exit). Screenshots every screen × 6 states, runs axe. **Better:** "eyeball the pixels" is mandatory but unaided — 9 heuristics, no per-heuristic checklist.
- **/qa** — **gate/orchestrator.** Decomposes change → runs design-QA → `/ship` → UAT in order; red gate stops the line. **Better:** assumes a baseline SHA from a prior green run; greenfield features have none and the skill can't record one.
- **/uat** — **gate** (entry: Chromium + login; Full mode requires a benchmark web search). Lean smoke or Full 7-phase audit → HTML+PDF. **Better:** a blocked-egress benchmark degrades to a WARN the operator can miss if they don't run Full.
- **/manual-uat** — _advisory._ Agent drives the browser as each role, happy + worst path, probes RBAC live. **Better:** if Playwright MCP is absent it says "error out" — never suggests `/uat` as the fallback.

### Build & verification

- **/ship** — **THE gate** (see §5). Pre-push: typecheck→lint→tests→build→secret-scan→audit + the phase-A pillar gates. **Better:** its own error message for a missing gitleaks lists only `brew` and the GitHub release — **[correction]** it omits `apt-get install gitleaks`, which works and would have unblocked the prior session. Fix the message.
- **/cover** — _advisory._ AI-generates only tests that pass **and** raise `lib/**` coverage. **Better:** below Node 22.13 the coverage floor degrades to WARN; the skill says so but doesn't prescribe "upgrade Node."
- **/scaffold-entity** — **gate** (Restricted field → `SCRUB_FIELDS` + test must extend same-commit). Model + zod + routes + pages + nav + recycling-bin in one command. **Better:** doesn't warn about the soft-delete × pagination count-mismatch nuance it introduces.
- **/conform** — **gate** (report-and-approve-only; never auto-fixes foreign code). Scans → gaps vs hard-rules → applies only approved changes → pushes to a fresh template repo. **Better:** on a live-credential hit it says "rotate now" with no next-step (rotate where? scrub the commit? re-scan?).
- **/audit** — _advisory._ gitleaks + npm-audit + Semgrep (+ optional trufflehog/trivy) on a path. **Better:** the semgrep bootstrap (pipx→pip→docker) has no timeout — a stalled install is silent.

### Code-review support

- **/stack-advisor** — _advisory._ Injects framework-correct RSC/Prisma/Postgres patterns _while building_. **Better:** purely reactive to "what's the right way to X" — if you never ask, no advice materializes.

### Infrastructure & deployment

- **/deploy** — _advisory._ Provisions Neon+Vercel for an existing fork; preflight is the egress authority. **Better:** doesn't validate the `project.config.json` slug/org actually matches the GitHub repo — a copy-pasted config provisions the wrong project.
- **/docker** — _advisory._ Build standalone image / bring up local stack (ADR-030). **Better:** warns "don't unconditionally enable `output:'standalone'`" but no lint rule catches a fork that does — it silently breaks Vercel.
- **/scale-up** — _advisory._ Menu of ~15 growth recipes (uploads, cron, jobs, realtime, Upstash…), each with trigger + recipe + cost. **Better:** no dependency/conflict matrix — add Upstash but leave the in-memory limiter and you ship both.

### Process & knowledge

- **/blueprint** — **gate** (shared tier: new route/page fails `/ship` without a matching `docs/blueprints/*.md`; personal tier warns). Pins WHAT before HOW. **Better:** the lightweight track can't prove an existing recipe was checked.
- **/quickstart** — **gate** (`/ship` green before push, no "it's disposable" exception). Paragraph → live URL in ~10 min. **Better:** no sizing guidance for "propose the entities" (minimal vs. detailed).
- **/adr** — _advisory._ New ADR with next number/date/owner. **Better:** no mechanism to link the ADR from CLAUDE.md/code/superseded ADRs → orphaned ADRs get re-litigated.
- **/remember** — _advisory._ Appends a dated line to `agent-memory.md` (reaches `main`, inherited by forks). **Better:** the ~150-line budget has no overflow warning — durable knowledge silently drops off.
- **/sync-from-template** — _advisory._ Path-scoped additive pull of template-owned layers; `lib/`/CLAUDE.md staged for review. **Better:** the documented hook-wiring trap (script pulled, `settings.json` binding skipped → silent no-op hook) has no automated post-sync verification.
- **/batch** — _advisory._ Per-file codemod as capped headless `claude -p` runs. **Better:** parked (failed) files stay half-applied in the tree — manual `git checkout` per file, no rollback.
- **/migrate-from** — _advisory._ Pull schema+data from a source Postgres into a fresh fork; Claude proposes the column mapping, operator reviews. **Better:** source-schema variance is high and the mapping is a one-shot proposal — no dry-run/round-trip validation before the seed is generated. _(Missed by the first-pass catalog; included here for completeness.)_

**Skills verdict:** ~7 skills carry a real internal gate (`/ship`, `/handoff`, `/design-qa`, `/qa`, `/uat`, `/scaffold-entity`, `/conform`, `/blueprint`+`/quickstart` via `/ship`). The other ~19 are **discipline you must remember** — their only "activation" is the advisory `skill-activation` hook nudging you.

---

## §5 — Hooks (`.claude/hooks/`, 15) — the enforcement front line

All 15 are wired in `settings.json` (no dead hooks). The critical column is **fail mode**: **every hook fails _open_** — if the hook script itself errors, it allows the action rather than blocking. Only `session-stop` _decides_ to block (fail-closed) as its normal path.

| Hook                            | Event                             | Blocking?             | Fail mode       | What / why                                                                                                                                                                      | How it could be better                                                                                                                                                                        |
| ------------------------------- | --------------------------------- | --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **build-vs-buy-gate** (ADR-032) | PreToolUse: Write (new file)      | **DENY**              | fail-open       | Denies a new `lib/` file unless `build-vs-buy-ledger.md` has a `Scope:` glob covering it — forces a reuse decision on record.                                                   | **Only new `Write`s.** An `Edit` that refactors existing code into a sprawling new module walks right past it. Glob matcher is minimal. Fail-open: a malformed ledger → gate silently allows. |
| **blueprint-gate** (ADR-033)    | PreToolUse: Write (new file)      | **DENY**              | fail-open       | Denies a new `app/api/**/route.ts` or `app/**/page.tsx` unless a `docs/blueprints/*.md` `Scope:` covers it.                                                                     | Only NEW routes/pages; editing an existing route into a feature isn't gated. Delete the blueprint and its files become ungated.                                                               |
| **dangerous-commands**          | PreToolUse: Bash                  | **DENY**              | fail-open       | Semantic deny of `rm -rf` on fatal targets, force-push, `chmod 777 -R`, `mkfs`/`dd`, curl-pipe-sh, fork bombs. Complements the lexical deny-list in settings.                   | Whitespace tokenization is shell-naive — `echo '; rm -rf /'` isn't parsed; no AST. Conservative by design, so it's a backstop, not a wall.                                                    |
| **protect-secrets**             | PreToolUse: Read/Grep/Bash        | **DENY**              | fail-open       | Blocks reading `.env*`/key files and Bash that prints Restricted env vars — closes the mid-session read boundary gitleaks (push-time) can't see.                                | Hardcoded secret-file/env list (no learning); `base64 .../id_rsa` obfuscation slips past; shell-var-in-quotes missed.                                                                         |
| **verbose-guard**               | PreToolUse: Bash                  | **DENY**              | fail-open       | Denies unbounded `npm test`/`build`/`tsc`/`git log` without redirection; suggests the cheaper piped form. Token thrift.                                                         | Brittle regex; `VERBOSE=1` override is unenforced (anyone prefixing it passes).                                                                                                               |
| **session-stop** (#14)          | Stop                              | **BLOCK on unpushed** | **fail-closed** | Hard-blocks the turn from ending while commits are unpushed (fresh containers clone only what's pushed = silent data loss); warns on uncommitted WIP.                           | Can't tell legit WIP from forgotten commit; one Stop attempt, no retry loop; dedup marker is per-session. The **one** gate that fails safe.                                                   |
| session-start.sh                | SessionStart                      | advisory              | fail-open       | Bootstraps `.env`/deps/Prisma client, warns on branch drift, renders handoff tables, surfaces `agent-memory.md`.                                                                | Drift stamp can go stale; 25s remote timeout may silently skip the drift check.                                                                                                               |
| skill-activation                | UserPromptSubmit + PreToolUse     | advisory              | fail-open       | Data-driven (`skill-rules.json`) keyword/path match → _suggests_ skills via `additionalContext`. Never blocks.                                                                  | No dedup across fires (you've seen it fire 3–10× per turn in this session); minimal globbing. The **only** thing that "activates" the 19 advisory skills — and it's a suggestion.             |
| rules-injection                 | PreToolUse (Edit/Write/MultiEdit) | advisory              | fail-open       | Path-lazy rule loading (V2-101): injects the matching `.claude/rules/*.md` body as `additionalContext` when you edit a path its frontmatter `globs:` cover. Never blocks.       | Fires per matching edit (no dedup, like skill-activation); a glob that doesn't cover a file the rule is about → silent no-load (regression-tested in `tests/harness/hooks.test.mjs`).         |
| bash-write-gate                 | PreToolUse (Bash)                 | deny (governance)     | fail-open       | Closes the shell bypass (V2-001): a `>`/`tee`/`cp`/`sed -i`/heredoc write to a gated surface (new route/page/`lib/`) hits the SAME blueprint/ledger checks the Write tool does. | Best-effort shell parse — a shell-variable path or `node -e` write can still evade (documented gap, `docs/findings-register.md`); existing-file edits exempted (existsSync).                  |
| routing-receipt                 | PreToolUse (Task)                 | advisory              | fail-open       | Logs each subagent spawn (agent type + model tier) so model-routing (ADR-022) leaves a receipt; never blocks.                                                                   | Log-only; no enforcement that the chosen tier actually fits the work.                                                                                                                         |
| post-tool-scan                  | PostToolUse                       | advisory              | fail-open       | Scans tool _results_ (≤300 KB) for live-secret patterns + prompt-injection markers; warns, never prints values.                                                                 | Loose regex → false positives; per-session dedup only; output-side, so it warns _after_ a secret already entered the transcript.                                                              |
| pre-compact-refresh             | PreCompact                        | advisory              | fail-open       | Re-injects the must-survive essentials (modified files, last `/ship`, open findings, operator goal) before compaction.                                                          | Regex-parses SESSION-HANDOFF (fragile to hand edits); caps at 25 files/bucket (truncates big changes).                                                                                        |
| auto-handoff                    | SessionEnd                        | advisory              | fail-open       | Re-renders handoff tables, surfaces push durability, guards the (disabled) auto-spawn.                                                                                          | Auto-spawn isn't truly autonomous (SessionEnd can't call the MCP); guard call has no timeout.                                                                                                 |
| session-receipt                 | SessionEnd                        | advisory              | fail-open       | Appends a per-session usage row (tokens, context, end reason) to a gitignored log; GCs `/tmp` markers.                                                                          | Naive row-count rotation; no query/aggregation; plaintext local log.                                                                                                                          |

**Hooks verdict:** The five **DENY** hooks are the real teeth. But because **all fail open**, the guarantee they provide is "we block the _obvious_ form when the hook runs cleanly" — not "this cannot happen." A crafted command, an `Edit` instead of a `Write`, or an exception inside the hook all bypass silently. Defense-in-depth, not a wall — which is the honest way to describe it.

---

## §6 — `/ship` gates (`scripts/ship.mjs`) — the active CI replacement

Phase A runs in parallel, phase B serial. **14 hard-fail; 4 skip if their tool/runtime is absent** (a real "green-but-didn't-actually-run" hole). Confirmed fully green this session (17 gates + the `--full` docker gate).

### Phase A (parallel)

| Gate                     | Checks                                                                                | Fail?                           | How it could be better                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck                | `tsc --noEmit`; auto-heals stale `.next/types`                                        | HARD                            | Static types only; no runtime/logic errors.                                                                                                                                                                                                                          |
| lint                     | ESLint (13 custom + next) `--cache`                                                   | HARD                            | Stale cache if rule code changes (manual clear).                                                                                                                                                                                                                     |
| contract tests           | `node --test`                                                                         | HARD                            | Presence, not coverage of new paths (that's the coverage gate).                                                                                                                                                                                                      |
| component tests          | `test:components`                                                                     | HARD                            | Test doubles miss real data-shape mismatches.                                                                                                                                                                                                                        |
| scalability              | flags `findMany` without `take/skip/cursor/parsePagination`                           | HARD                            | **Only scans first 250 chars** after `.findMany(` — a `take` past that is missed. Escape: `// pillar:scalable-ok`.                                                                                                                                                   |
| wave-offs                | any `status: open` in `findings-register.md` blocks green                             | HARD                            | Regex-based; a malformed (dateless) entry is silently skipped.                                                                                                                                                                                                       |
| tier                     | `personal` default fails if ≥2 human contributors                                     | HARD                            | **Bot detection is email/name substring** — a bot with a custom email (`ci@acme.com`) counts as human and forces a false escalation. Escape: `tierAck`.                                                                                                              |
| blueprint                | new route/migration needs a `docs/blueprints/*.md`                                    | HARD (shared) / WARN (personal) | **Added files only** — refactoring an existing route into a feature isn't flagged.                                                                                                                                                                                   |
| **complexity** (ADR-034) | NEW `.ts/.tsx` in app/lib/components/hooks over **350 LOC or 40 branch-tokens** → RED | HARD                            | **[key gap]** **Added-files-only** (ADR-034 v2 scope) — editing a 500→550-line file is invisible. Branch-token count is a **coarse cyclomatic proxy**: nested ternaries inflate it; a long procedural file with few branch keywords passes. Escape: `complexityAck`. |
| db-structure (ADR-031)   | ≥1 domain model; migrations non-empty; schema↔migration sync                          | HARD (a,b) / WARN (c)           | Sync check is only a WARN without `SHADOW_DATABASE_URL` — a drifted schema is silent until a shadow DB exists (skipped this session).                                                                                                                                |
| knip                     | dead-code / unused exports                                                            | HARD **if installed**           | **Skips (WARN) if knip binary absent** — silent hole.                                                                                                                                                                                                                |
| duplication              | jscpd, >3% duplicated lines                                                           | HARD **if installed**           | **Skips (WARN) if jscpd absent.** Coarse file-% metric.                                                                                                                                                                                                              |
| coverage                 | `lib/**` floors: lines 75 / fns 78 / branches 88 (ratcheted V2-403)                   | HARD **if Node ≥22.13**         | **Skips (WARN) below Node 22.13.** Aggregate can mask one untested high-value edge. lib-only — UI untracked.                                                                                                                                                         |

### Phase B (serial)

| Gate                            | Checks                                      | Fail?                        | How it could be better                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| build                           | production `next build`                     | HARD                         | Build-time only; runtime route errors slip to deploy.                                                                                                                                                                                                        |
| size-limit                      | gzipped client JS vs budget                 | HARD **if artifact present** | Skips (WARN) if tool/`.size-limit.json`/chunks absent.                                                                                                                                                                                                       |
| gitleaks                        | secret scan                                 | HARD                         | **Missing binary is a HARD FAIL, not a skip** (correctly mandatory). **[correction]** Its install hint omits `apt-get install gitleaks`, which works in this container — the prior session wrongly concluded it was uninstallable and planned `--no-verify`. |
| npm audit                       | High/Critical not in `audit-allowlist.json` | HARD                         | Malformed allowlist safe-fails to empty (every High+ fails — safe direction).                                                                                                                                                                                |
| docker (`--full` only, ADR-030) | build standalone image + trivy scan         | HARD build / WARN trivy      | Degrades to WARN if the Docker daemon is missing — a dev with no Docker can still push; CI expects the image.                                                                                                                                                |

**Ship verdict:** This is the strongest, most honest part of the harness — 14 real hard-fails and it genuinely gates every push (pre-push husky hook re-runs it). The two structural weaknesses: **skip-if-absent gates** (knip/jscpd/coverage/size-limit) can report green having never run, and the **newest pillar gates measure a proxy on added files only** — they enforce that you _paused at the checkpoint_, not that the code is actually simple, planned, or reuse-first.

---

## §7 — Custom ESLint rules (`eslint-rules/`, 13, all `error`)

Each encodes a hard-rule invariant. The universal gap: **AST-only, so reflective/dynamic/destructured forms escape** — accepted because a justified one-line `eslint-disable` is the intended escape hatch and false positives are cheap.

| Rule                        | Forbids                                                                                                                                                                                                                 | Why (invariant)                                                                                                                   | Escapes                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| no-any-cast-on-session      | `session as any`                                                                                                                                                                                                        | Casting re-introduces untyped `role` access → bypasses RBAC.                                                                      | Heuristic on `session`/`ctx`/`req` — benign `config.session` false-positives (cheap).                                             |
| no-prisma-in-client         | `@/lib/prisma` in `"use client"`                                                                                                                                                                                        | UI → API → Prisma layering.                                                                                                       | Dynamic `import()` in a callback not tracked.                                                                                     |
| no-bare-internal-route      | `/api/internal/*` handler without `withInternalAuth`                                                                                                                                                                    | Internal routes bypass middleware auth — the shared-secret header is the only lock (ADR-018).                                     | `export function GET(){}` form can't be wrapped; composed-elsewhere handlers untracked.                                           |
| no-raw-sql-unsafe           | `$queryRawUnsafe`/`$executeRawUnsafe`                                                                                                                                                                                   | Unparameterized SQL = injection (OWASP A03).                                                                                      | Reflective `.call(prisma, sql)` / destructured names missed.                                                                      |
| no-rate-limit-inside-auth   | `withAuth(withRateLimit(h))`                                                                                                                                                                                            | Limiter must run OUTERMOST so floods throttle before auth work (OWASP A04).                                                       | Only direct lexical nesting — indirection via a variable slips through.                                                           |
| no-raw-hex-color            | hex literals outside palette files                                                                                                                                                                                      | Tokens from `tokens.css`/`brand.config` so rebrand + dark are consistent (ADR-015).                                               | 4-digit hex in a string not caught; CSS files out of scope.                                                                       |
| no-prisma-unfiltered-import | `prismaUnfiltered` outside allowlist                                                                                                                                                                                    | It bypasses soft-delete **and** audit — allowlisted to auth/recycling-bin only.                                                   | Dynamic/namespace import not detected.                                                                                            |
| no-secret-env-in-console    | Restricted `process.env.<X>` OR `env.<X>` (the `@/lib/env` wrapper) reaching any log sink — `console.*` or a logger method (`log/info/warn/error/debug/…`); covers `DATABASE_URL`/`REDIS_URL` and other credential URLs | Logging Restricted env vars leaks secrets (SECURITY.md §1).                                                                       | Substring match → `GITHUB_TOKEN_BACKUP` false-positives (cheap); a secret aliased into a local var before logging is not tracked. |
| no-unaudited-bulk-write     | `updateMany/createMany/deleteMany/upsert/*AndReturn` on audited models                                                                                                                                                  | Bulk/upsert bypass the per-row audit extension (ADR-010); `deleteMany` also skips soft-delete.                                    | Reflective/destructured calls; reused `tx` alias can false-positive.                                                              |
| no-restricted-export-column | secret-named field as a `toExcel` column key                                                                                                                                                                            | `SCRUB_FIELDS` doesn't cover Excel exports — a raw secret would land in the `.xlsx` (SECURITY.md §1).                             | Only inline object-literal descriptors; a columns array in a variable / computed key / `format` callback escapes.                 |
| no-direct-anthropic-sdk     | `@anthropic-ai/sdk` / `new Anthropic` outside `lib/ai/**`                                                                                                                                                               | Model access must go through the `@/lib/ai` barrel so `isAiConfigured()`, default model, and tracing can't be bypassed (ADR-042). | Reflective/dynamic import of the SDK not detected.                                                                                |
| no-arbitrary-className      | arbitrary Tailwind values on spacing (`p/m/gap/space`) + `text-[…px]`                                                                                                                                                   | Keeps layout on the 4px scale / type scale — the layout sibling of `no-raw-hex-color` (V2-304).                                   | JSX/TSX-scoped; a className built in a variable / `cn()` call escapes.                                                            |
| no-literal-jsx-text         | literal user-facing text in JSX (text nodes + `placeholder/title/alt`)                                                                                                                                                  | Copy must route through next-intl so `messages/*.json` stays the single chokepoint (V2-305).                                      | `aria-*`/`data-*`/code/pre + dev-pages/root-boundaries/tests exempt by design.                                                    |

**Rules verdict:** Tight, security-focused, well-motivated. The escape surface (reflection/dynamic/destructure) is the same for all thirteen — a determined bypass is possible, but each is a real tripwire for the _accidental_ form, which is what actually happens.

---

## §8 — Core `lib/` primitives

The invariants the whole codebase leans on. `lib/` files are Ask-before (and now build-vs-buy-gated).

- **api-helpers.ts** — `withAuth`/`withAdminAuth`/`withEditorAuth`/`withInternalAuth`/`withApiAuth`/`withRateLimit`. _Invariant:_ every route is wrapped; audit context (IP/UA/user) captured per authed call. _Better:_ nothing at **runtime** forces a route to use a wrapper — the lint rule catches the internal-route case only; an ordinary unwrapped export is caught by convention + review, not the machine.
- **auth.ts** — Credentials + Entra ID SSO helpers; JWT sessions; soft-deleted users can't log in; VIEWER least-privilege SSO default. _Better:_ no password-complexity policy; bcrypt cost hardcoded; no refresh-token flow (logout ⇒ rotate `AUTH_SECRET`); on an Auth.js **beta**.
- **email.ts** — `sendEmail` gated by `SMTP_HOST`; returns `{sent:false}` (never throws); logs metadata only. _Better:_ no retry/templating/attachments/bounce handling.
- **export.ts** — `toExcel` + formula-injection neutralization (`= + - @` prefixes). _Invariant:_ caller must gate + row-filter; Restricted columns forbidden (lint-enforced). _Better:_ no audit capture of exports; no chunking (large sets can timeout serverless).
- **rate-limit.ts** — in-memory token bucket, 10/min/IP on `/api/auth/*`. _Invariant:_ single-instance only. _Better:_ **bypassed by horizontal scaling** (per-instance buckets) — must swap to Upstash; IP-only, resets on restart. No e2e test for the multi-instance bypass.
- **prisma/audit-extension.ts** — `SCRUB_FIELDS` redaction + `recordAudit` on every create/update/delete outside EXCLUDE. _Invariant:_ Restricted → `[redacted]`; a new Restricted column must extend `SCRUB_FIELDS` + its test same-commit. _Better:_ covers audit values, **not exports** (separate rule); nested-relation changes untracked; audit readable by any ADMIN (no tenant partition).
- **prisma/soft-delete-extension.ts** — rewrites `delete()` → `update{deletedAt,deletedBy}`; reads auto-filter `deletedAt:null`. _Better:_ **nested includes still surface soft-deleted children** (manual per-include filter) — the sharpest correctness footgun in `lib/`; interacts with pagination counts; no retention policy (opt-in purge cron).
- **validations/** — zod at every boundary (`common.ts`, `user.ts`). _Better:_ per-route copy-paste; no OpenAPI generation; many entities lack a dedicated schema file.

---

## §9 — Governance docs

- **SECURITY.md** — 4 data classes, auth/authz model, SCRUB_FIELDS, in-memory brute-force defense, findings register §12/§13. _Better:_ no password-reset token lifetime/rotation policy; no column-key management (out of scope for the rail, but say so per-fork).
- **docs/uat-rubric.md** — the 5 Pillars as gates + anti-slop defaults (one accent, one primary action, no nested Cards, lucide only, no emoji). _Better:_ "axe clean of serious/critical" maps to WCAG 2.2 AA (per the rubric's a11y criteria). _(The dark-mode axe false-positive flood was FIXED — `8051d85` painted the body background so the contrast probe stopped mis-firing; agent-memory 2026-07-03.)_
- **docs/token-policy.md** — CLAUDE.md ~~200-line budget, quiet gates, model-tier routing (haiku/sonnet/opus), `/compact` discipline. _Better:_ **no hard token budget in `/ship`** — the "~~$13/dev/day" figure is advisory; nothing gates a session that re-runs `/deploy` (uncached, full cost each time).
- **docs/build-vs-buy-ledger.md** (ADR-032) — durable record of build-vs-buy calls before new `lib/` files. _Better:_ **no baseline** — pre-ADR-032 "build" decisions aren't backfilled, so the ledger starts near-empty and the gate has nothing to compare historical modules against.
- **docs/recipes-sidecar-services.md** — self-hosted sidecar recipes (Stirling-PDF export, crawl4ai scraping) behind internal-auth. _Better:_ suggest-only (not wired); crawl4ai lacks the cost/license notes the PDF recipe has.

---

## §10 — ADRs (`docs/decisions/`, 001–034)

The decision ledger. Four are **enforcement gates** (bold); the rest are records. Superseded ones noted.

| ADR | Decision (one line)                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------- |
| 001 | Locked baseline stack + invariants _(deploy/infra parts superseded by 006; UI by 029)_                               |
| 002 | Observability: Sentry + Better Uptime                                                                                |
| 003 | Release process (`/release` after `/promote`)                                                                        |
| 004 | CI-driven ops (Claude proposes, Actions execute)                                                                     |
| 005 | Deployment options (keep droplet, document PaaS)                                                                     |
| 006 | **Pivot to Vercel + Neon** (prototype rail) — supersedes 001 infra                                                   |
| 007 | Solo-rail optimization (free plan, conformance, tiers)                                                               |
| 008 | UAT via Playwright                                                                                                   |
| 009 | Headless deploy from a web session (`/deploy`)                                                                       |
| 010 | Audit completeness + atomicity (soft-delete/restore flow)                                                            |
| 011 | Tenancy by deployment (one Vercel+Neon per tool)                                                                     |
| 012 | Stay REST + zod (not tRPC); OpenAPI seam at handoff                                                                  |
| 013 | Public API versioning (`/api/v1` seam)                                                                               |
| 014 | Shared-tier recipe library (`docs/recipes/`)                                                                         |
| 015 | Design quality via a taste layer, not a stack swap                                                                   |
| 016 | "Vibe Inspector" E2E tool → own repo                                                                                 |
| 017 | Dependency currency (in-range continuous, quarterly majors)                                                          |
| 018 | Audit-log retention via Vercel Cron (opt-in `CRON_SECRET`)                                                           |
| 019 | Token-thrift harness                                                                                                 |
| 020 | Mandatory post-push senior code review                                                                               |
| 021 | Client data layer: TanStack Query                                                                                    |
| 022 | Cross-session agent memory + model routing                                                                           |
| 023 | Docker as opt-in self-host rail _(superseded by 030)_                                                                |
| 024 | MFA via Microsoft Entra ID SSO                                                                                       |
| 025 | **Tiered enforcement gates** (pillars-as-gates, Stop-hook block)                                                     |
| 026 | Native design system                                                                                                 |
| 027 | UI library: Ant Design 6 skeleton _(superseded by 029)_                                                              |
| 028 | Enterprise design-system + optional i18n _(superseded by 029)_                                                       |
| 029 | **UI replatform: Ant Design → Tailwind v4 + shadcn/ui** (+ Tremor named)                                             |
| 030 | **Docker as standard build artifact** (gated at `/ship --full`, /deploy, /handoff, CI) — supersedes 023              |
| 031 | **Mandatory structured database** (`/ship` db-structure gate)                                                        |
| 032 | **Build-vs-Buy enforcement gate** (PreToolUse deny + ledger) — _new 2026-07-10_                                      |
| 033 | **Blueprint-before-build enforcement gate** (PreToolUse deny + blueprint) — _new 2026-07-10_                         |
| 034 | **Complexity-budget enforcement gate** (`/ship` phase A, 350 LOC / 40 branch-tokens, added-files) — _new 2026-07-10_ |

**Detail on the three new gates (the reason this inventory exists):**

- **032 build-vs-buy** — converts advisory "market-benchmark & reuse" into a hard gate: no new `lib/` file without a ledger entry. _Stated limitation:_ friction on legit new files; _real limitation:_ only `Write`s of new files, not `Edit`-refactors, and fail-open.
- **033 blueprint-before-build** — mirrors it for planning: no new route/page without a matching blueprint. _Limitation:_ depends on `/blueprint` emitting a `Scope:` line; added-files-only; fail-open.
- **034 complexity-budget** — caps new-file size/branching, zero new deps. _Stated limitation (ADR text itself):_ token/line proxy is coarser than a real AST cyclomatic metric, and **v1 covers only ADDED files, not edits to existing over-complicated code.**

---

## §11 — The enforcement audit (the headline)

Judging the **whole harness** through the operator's lens — _what's actually enforced vs. merely advised, and where the gaps are_:

### What the enforcement layer genuinely fixed

The three new gates are real and load-bearing. Before them, "benchmark before building," "blueprint before building," and "don't over-engineer" were prose in CLAUDE.md that a model under load skips. Now each has **a hook or a ship gate + a committed adjudication artifact** (ledger / blueprint / findings-register `*Ack`). That is a genuine structural upgrade: the behavior now leaves a paper trail, and the operator adjudicates deviations instead of never seeing them. The `/ship` gate (14 hard-fails) and the 13 lint rules are the mature, trustworthy core.

### The five systemic gaps (ranked)

1. **Every guard hook is fail-open.** build-vs-buy, blueprint, dangerous-commands, protect-secrets, verbose-guard all _allow the action_ if the hook script throws. Only `session-stop` fails closed. So the guarantee is "blocks the obvious form when the hook runs clean," never "cannot happen." Honest framing: defense-in-depth, not a wall.
2. **The gates force the checkpoint, not the substance.** complexity measures a coarse branch-token proxy; blueprint checks a file _exists_ with a matching glob, not that it's a _good_ blueprint; build-vs-buy checks a ledger _entry exists_, not that a real market scan happened. You can satisfy all three with a rubber-stamp. They make skipping _visible and adjudicated_ — which is the actual win — but they don't make the work _good_.
3. **"Added-files-only" is a wide blind spot.** complexity (034), blueprint (033), and build-vs-buy (032) all fire on **new files**. The most common real-world sprawl — an `Edit` growing an existing route/module, or refactoring code into a new shape via edits — sails past all three. This is the single highest-value gap to close (diff-scope the edits, not just additions).
4. **Skip-if-absent ship gates report green without running.** knip, jscpd, coverage, size-limit all degrade to WARN if their tool/runtime is missing — a fresh environment can show "ship green" having silently skipped four checks. Contrast gitleaks, which correctly hard-fails when absent. Make the important ones hard-fail-on-absent (or at least a loud, adjudicated skip).
5. **The automatic reviewer isn't automatic.** senior-code-reviewer is "runs after every push" in doctrine but dormant until CI is funded; today it runs only if invoked. Same shape as the old complaint (advisory, not enforced) one layer up.

### Smaller but real

- **gitleaks install message is wrong** — omits `apt-get install gitleaks`, which works; it cost the prior session a false "uninstallable, use `--no-verify`" conclusion. **(Fixed in practice this session; the message in `ship.mjs` should be updated.)**
- **chrome-devtools MCP is unwired** speculative capacity; **Tremor** is named in ADR-029 but never installed (recharts ships) — doc/stack drift.
- **Tier bot-detection** is email-substring fragile.
- **Soft-delete nested-include leakage** is a latent correctness bug the scaffolder doesn't warn about.
- **No hard token budget** despite a token-thrift culture — the one place the "advisory not enforced" pattern persists by design.

### One-line verdict

The harness is unusually disciplined for a prototype template, and this session's three gates close the exact advisory-vs-enforced gap the operator complained about — **but they enforce the _pause_, not the _quality_, they're blind to edits, and they fail open.** The next increment isn't more gates; it's making the existing five deny-hooks fail _closed_ on their own errors, extending the three new gates from added-files to the full diff, and turning the four skip-if-absent ship checks into hard-fails. That converts "checkpoint theater" into checkpoints with teeth.
