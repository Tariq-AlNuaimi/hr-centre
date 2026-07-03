# Blueprint — deferred #11: specialist stack-advisor (build-time)

**Status:** ✅ **IMPLEMENTED (session 15, 2026-07-03)** — shipped as the `/stack-advisor` skill
(`.claude/skills/stack-advisor/SKILL.md`), wired into `.claude/skill-rules.json`; the optional
thin `stack-expert` subagent was not built (no offload need yet). · tier: template-harness
(reaches all forks) · reverses the session-14 drop at the operator's direction (the item is
**ADOPT**, not dropped).

## Problem & outcome
The review rail catches stack mistakes **after** they're written (`/code-review` diff gate,
then the `senior-code-reviewer` breadth pass). There is no **build-time** surface that injects
Next.js 16 / Prisma 7 / Postgres expertise **while** a route, query, or component is being
written — so the operator (a non-developer iterating with Claude) relies on the main agent's
generalist knowledge and only learns of a stack-specific misstep at QA. **Outcome:** a single,
curated "stack-expert" advisor the main session can pull in *at the moment of building* to get
framework-correct guidance (RSC data-fetching, Prisma query shape + indexing, Postgres access
patterns) — shaping the code as it's written, not flagging it later.

## The core decision — how do we add it? (this is what "don't integrate blindly" is asking)

Two mechanisms exist in this template. They are **not** interchangeable; the difference is
*where the expertise runs*.

| | **Skill** (`.claude/skills/<name>/SKILL.md`) | **Subagent** (`.claude/agents/<name>.md`) |
|---|---|---|
| What it is | A procedure/knowledge doc **injected into the main agent's context** when invoked (`/stack-advisor` or the Skill tool). | A **separate agent** with its own system prompt/model/tools, spawned via the Agent tool, running in an **isolated context**. |
| Where it runs | Inline — the *current* agent, mid-build, applies the guidance to the code it's writing right now. | Elsewhere — a worker you dispatch a self-contained question to; it investigates and **returns a report**. |
| Cost model | Loads guidance into the live context (counts against the session window). No round-trip. | Zero main-context cost during its run; returns only a condensed answer. Pays spawn + its own tokens. |
| Best for | **Build-time advice** that must shape the code inline: "what's the right RSC pattern / Prisma query / index here?" | **Offloaded deep investigation**: "design the optimal query + index for this access pattern and report back" — keeps a heavy dive out of main context (like `scout`). |
| Editing | The main agent keeps editing with the advice in-context. | Read-only worker; it advises, the main session edits. |

**Recommendation: skill-first, with an optional thin subagent slice.**
- Primary deliverable: a **`/stack-advisor` skill** — a curated, on-token guidance doc the main
  session pulls in when building a route/query/component. This is the true "build-time advisor":
  the value is *injected expertise that shapes the code inline*, which is exactly what a skill is.
- Optional secondary: a **thin `stack-expert` subagent** for the offload case only (a deep query/
  index design dive you don't want polluting main context — the `scout` pattern, but stack-expert
  instead of read-only-finder). Add this *only if* the skill proves it needs an offloaded dive;
  don't build the fleet up front.
- We do **not** build three persona agents (nextjs-pro / postgres-pro / prisma-expert). The item's
  own guardrail ("one composed seed, not a fleet") holds — one advisor covering the three stack
  layers, because in this template they're always used together (a route reads via Prisma against
  Postgres in one RSC).

## Anti-duplication check (the reason #11 was first flagged for drop)
`senior-code-reviewer` = **post-push, read-only, 5-lens REVIEW** ("what's wrong with what changed").
`/stack-advisor` = **build-time, guidance, ADVICE** ("what's the right way to build this next").
Different tense, different moment, different output (report vs. injected guidance). The advisor
must **not** ship a review protocol or severity lenses — if it starts reviewing, it's duplicating
senior-code-reviewer and should be cut. It also must not restate the 10 ESLint rules (those are
enforced automatically); it carries the *positive* patterns the rules don't teach (e.g. "prefer an
RSC read over a client `useEffect` fetch; here's the shape"), sourced from `docs/design-recipes.md`,
`docs/recipes.md`, and the ADRs — pointing at existing primitives, never re-documenting them.

## Market scan (CLAUDE.md requires it before building)
The named personas (`nextjs-pro`, `postgres-pro`, `prisma-expert`) come from community agent
collections (wshobson/agents-style seeds). They are **review/generalist personas**, not tuned to
this template's locked stack, its `lib/` primitives, or its "UI → API route → service → Prisma"
rule — dropping them in raw would duplicate `senior-code-reviewer` and drift from ADR-001. The win
here is a **thin, template-specific advisor** that points at *our* recipes/primitives, not a
vendored generic agent. Concept-over-dependency (ADR-022).

## User stories + acceptance criteria
- **US1 — build-time RSC guidance.** As the operator building a new page, I invoke `/stack-advisor`
  and get the correct Next 16 RSC read pattern citing `docs/design-recipes.md` + an existing
  `components/shared/*` primitive. **AC:** advice cites a real recipe/primitive; suggests no
  client-side fetch where an RSC read fits; no new dep proposed without the Ask-before gate.
- **US2 — Prisma/Postgres query shape.** As the operator adding a list route, I get a bounded,
  index-aware Prisma query (pagination, no N+1, no `SELECT *`) consistent with Pillar 4. **AC:**
  advice respects the scalability gate (bounded result set), the audit/soft-delete invariants, and
  the `no-unaudited-bulk-write` rule; never proposes raw SQL outside the parameterized forms.
- **US3 — non-duplication.** As a maintainer, I can see the advisor never emits a severity-ranked
  review. **AC:** the skill has no review/lens/severity language; `senior-code-reviewer` still owns
  review.

## Scenarios
- **Happy:** operator building a route → `/stack-advisor` → gets the RSC + bounded-Prisma pattern →
  builds it right the first time → `/ship` green, `/design-qa` clean, no rework at QA.
- **Worst:** advisor tempted to review existing code or restate ESLint rules → **must decline** and
  point to `/code-review` / `senior-code-reviewer` / the lint output. Advisor proposing a >50 KB dep
  or raw SQL → must route through the Ask-before gate, not advise around it.

## Five pillars
Speed (inline guidance, no extra round-trip in the skill form) · Secure (advisor never bypasses auth
wrappers/zod/Ask-before; it *teaches* them) · Maintainable (one composed seed, points at existing
primitives, no fleet) · Scalable (Pillar-4 guidance is core to US2) · High-Quality (build-it-right-
first-time is the entire premise).

## Open questions (resolved with operator, session 14)
- **Skill vs agent?** → build-time advisor ⇒ **skill-first** (this doc's recommendation), thin
  subagent only if an offload need appears.
- **How many?** → **one** composed stack-expert (not the 3 personas).
- **Now or later?** → **blueprint now, implement next session** (operator's call).

## Implementation checklist (next session)
1. `git checkout -B <branch> origin/main` (fresh base; PR #65 already merged).
2. Write `.claude/skills/stack-advisor/SKILL.md` — frontmatter (name/description/trigger phrases)
   + body: the three-layer guidance (Next 16 RSC, Prisma 7, Postgres access) as *positive patterns
   pointing at `docs/design-recipes.md` / `docs/recipes.md` / ADRs / `components/shared/*`*, with an
   explicit "I advise, I do not review — see senior-code-reviewer" boundary.
3. Register it in the skill list / `skill-rules.json` so build triggers surface it (mirror an
   existing skill's wiring).
4. (Optional) `.claude/agents/stack-expert.md` ONLY for the offloaded deep-dive case, `scout`-shaped.
5. Update `docs/agent-memory.md` (durable: advisor exists, is build-time, is NOT a reviewer).
6. `/ship` green → land on `main`.
