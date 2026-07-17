# Harness orientation — how the system fits together (#27)

**Audience:** a new maintainer or contributor to the _harness_ (the `.claude/` agent machinery + the
gates), not the product. **Read this before** `docs/runbooks/maintainer.md` — the runbook tells you
_how to change_ a piece safely; this tells you _what the pieces are and how they connect_, so those
procedures make sense. The bus-factor **floor** is the runbook (V2-505); this is the **mental model**
above it (#27, the bounded bus-factor slice).

Companion docs: `CLAUDE.md` (the binding constitution), `docs/REPO-MAP.md` ("where is X"),
`docs/repo-architecture.md` (the _product_ architecture), `docs/HARNESS-V2-CLOSEOUT.md` (how the
harness got here). This doc is the glue between them.

## What the harness is

A product template (Next.js 16 + Prisma 7 + Auth.js, ADR-001) with an **agent harness** layered on
top: instructions, gates, hooks, skills, and specialist agents that let a non-developer operator
drive Claude to build internal tools safely, then hand production to IT. The harness is the
`.claude/` tree + the `/ship` gates + the ADR/ledger/register docs. Everything below is _that_ layer.

## The eight systems (and how they connect)

1. **The constitution + lazy rules.** `CLAUDE.md` is the always-on binding law (≤8 KB — the context
   budget, V2-101). Domain detail lives in `.claude/rules/*.md`, loaded **lazily** when you touch a
   matching path (a `rules-injection` hook surfaces the right file on an edit). → _Read the rule file
   for the area before you change it._

2. **The enforcement quartet.** Four gates, enforced at TWO different moments (mirror `CLAUDE.md`'s
   "denied/RED" wording): **two PreToolUse hooks DENY at write time** — **build-vs-buy** (ADR-032 →
   a `docs/build-vs-buy-ledger.md` entry with a `Considered:` line) and **blueprint** (ADR-033 → a
   `docs/blueprints/*.md` with a covering `Scope:`) block the Write/Bash outright until the artifact
   exists (`bash-write-gate` covers shell writes too). **Two more turn `/ship` RED after the fact** —
   **complexity** (ADR-034 → `/ship`'s phase-A budget check on the diff; a `complexityAck` waiver +
   register line clears it) and **ai-eval** (ADR-036/042, dormant `/ship` phase-B). → _A new `lib/**`,
   `app/api/**/route.ts`, `app/**/page.tsx`, or `scripts/**` file is DENIED at write without its
   ledger/blueprint entry; an over-budget file WRITES but reds `/ship`._

3. **`/ship` — the active gate.** `npm run ship` (warm, ~60–90 s, DB-free) is what makes a push
   allowed (a `Stop`/pre-push hook enforces it). **`ship:full`** adds docker + BDD + integration +
   the SBOM license gate (ADR-061/O5). CI is dormant on the free plan, so `/ship` _is_ CI. → _Never
   land red; the warm loop stays fast because DB/app/docker work lives in `ship:full`._

4. **The tool-time hooks.** Beyond the gate quartet: **`protect-secrets`** (fail-closed — denies
   reading OR writing real secret material, incl. Bash/Write/Edit/MultiEdit), **`dangerous-commands`**
   (fail-closed — the semantic backstop under the lexical deny-list), **`skill-activation`** (advisory
   — suggests a skill by keyword/path), **`rules-injection`** (surfaces the lazy rule file). → _Hooks
   are the runtime floor; loosening one is security-sensitive (runbook + a register line)._

5. **The skills lifecycle.** 34 skills (`.claude/skills/*/SKILL.md`, agentskills.io-conformant, gated
   by `skill-check`/V2-503) cover idea→URL: `/quickstart`, `/blueprint`, `/scaffold-entity`,
   `/design-system`, `/ship`, `/qa`, `/uat`, `/deploy`, `/handoff`, and the harness tools
   (`/fan-out`, `/adopt`, `/retro`, `/docs-current`, …). → _Discover via the skill list; each SKILL.md
   is self-documenting._

6. **The review rail (two-stage).** Before a push touching auth/schemas/API/`lib/`: `/code-review`
   (pre-push diff gate). After every code push: the **`senior-code-reviewer`** agent (breadth). Both
   run **Stage 1 spec-compliance before Stage 2 quality** (V2-206). Specialist agents: `scout`
   (haiku reads), `security-architect` (opus threat-model), `sre` (ops). → _Route work to the model
   tier that fits (ADR-022); the review rail is where the Phase-4/5 real bugs were caught._

7. **The decision + finding records.** **ADRs** (`docs/decisions/`, MADR template via `/adr`) are the
   architectural law; changing the ADR-001 locked stack needs a _superseding_ ADR. The
   **build-vs-buy ledger** records every build-vs-adopt call; the **findings register**
   (`docs/findings-register.md`) holds wave-offs/adjudications (operator-only to flip). **SECURITY.md**
   is the security reference. → _Decisions go in an ADR, not chat; wave-offs go in the register, not
   silence._

8. **The memory lifecycle.** Durable cross-session knowledge → `docs/agent-memory.md` (reaches
   `main`, inherited by forks, add via `/remember`). In-flight state → `docs/session-state.json` +
   `docs/SESSION-HANDOFF.md` (branch-only, pruned from forks, V2-506). → _What the next session must
   not rediscover goes in agent-memory._

## The flow (how a change moves through the systems)

```
idea → /blueprint (contract) → build (gate quartet allows the files) → /ship green
     → push (pre-push /ship) → senior-code-reviewer (post-push) → fix findings
     → land on main → /remember durable lessons
```

Each arrow is enforced, not optional: the gate quartet blocks an unplanned file, `/ship` blocks a red
push, the review rail catches what the diff gate misses, and `main` only ever carries green work.

## Contributor onboarding — your first safe change

1. **Read:** `CLAUDE.md` (skim all; internalize the Hard rules + Ask-before list), this doc, and the
   `.claude/rules/*.md` for the area you'll touch.
2. **Pick something small** that is NOT on the Ask-before surface (avoid `lib/auth.ts`,
   `middleware.ts`, `eslint-rules/**`, `lib/prisma/**`, `.claude/settings.json` permissions to start).
3. **Follow the runbook** (`docs/runbooks/maintainer.md`) for the exact procedure for your change type
   (an ESLint rule, a hook, a `/ship` gate, an ADR, a dependency).
4. **Gate it:** `npm run ship` green. If you touched a hook/rule, `npm run test:hooks` /
   `test:lint-rules` too.
5. **Get it reviewed:** run `/code-review` on the diff; after pushing, the `senior-code-reviewer`
   agent — resolve its findings before calling it done.
6. **Land green on `main`;** record any durable lesson via `/remember`.

If you're unsure whether a change is high-blast-radius or on the Ask-before surface: **stop and ask
the operator.** Tightening the floor is cheap; loosening it needs a human decision on the record.
