# Deep comparison — index

Per-category, tit-for-tat comparison of **this template's harness** against the
top ~10 GitHub repos in each slice of the Claude Code / agentic-coding ecosystem.
Snapshot: **2026-07-02**. Research via fan-out web search + this repo's own
harness inventory.

## The three layers

This folder is the **detail layer** of a three-layer comparison. Read top-down:

1. **`../claude-ecosystem-comparison.md`** — the 6 **harness-structure**
   categories (curated collections, skills, subagents, hooks, MCP, frameworks),
   with a top-10 per category and the headline comparison. → maps to files
   **01–06** here.
2. **`../claude-ecosystem-comparison-part2.md`** — the 16 **discipline**
   categories that map onto the Five Pillars and the lifecycle skills, with a
   top-10 + coverage scorecard per discipline. → maps to files **07–22** here.
3. **`01–22` in this folder** — the tit-for-tat detail: for each category, every
   one of the ~10 repos scored in a 5-column table
   **`Repo | what THEY have | what WE have | who wins & why | recommendation`**,
   plus a synthesis paragraph.

> ⚠️ **On star counts.** This research environment's outbound proxy inflates
> GitHub star numbers (repos created in late 2025 reading 100k–244k). Treat every
> star figure across all three layers as a **relative ranking tier, not a literal
> count**. Rankings are consistent; absolute digits are not.

## Category index

Each row links to the detail file and gives the one-line verdict for that
category.

| #                                | Category                      | Layer      | Who wins                                                        |
| -------------------------------- | ----------------------------- | ---------- | --------------------------------------------------------------- |
| [01](./01-collections.md)        | Curated / Awesome collections | Harness    | They win (discovery) — consume, don't compete                   |
| [02](./02-skills.md)             | Skills collections            | Harness    | They win on portable reuse                                      |
| [03](./03-subagents.md)          | Subagents                     | Harness    | They win on breadth; we win on integration                      |
| [04](./04-hooks.md)              | Hooks                         | Harness    | Split — they win breadth, we win durability                     |
| [05](./05-mcp.md)                | MCP servers                   | Harness    | We're a consumer — wire it, don't compete                       |
| [06](./06-frameworks.md)         | Config / workflow frameworks  | Harness    | **We win** (end-to-end factory)                                 |
| [07](./07-scalability.md)        | Scalability                   | Discipline | Split — they win runtime, we win static gate                    |
| [08](./08-maintainability.md)    | Maintainability               | Discipline | They win on measurement; we win on enforcement                  |
| [09](./09-quality.md)            | Quality                       | Discipline | We win on gating; SonarQube wins on scored metrics              |
| [10](./10-security.md)           | Security                      | Discipline | **We win** (hardest-gated area)                                 |
| [11](./11-speed-of-dev.md)       | Speed of development          | Discipline | **We win** (whole idea-to-URL loop)                             |
| [12](./12-performance.md)        | Performance optimization      | Discipline | They win (our biggest tooling gap)                              |
| [13](./13-code-optimization.md)  | Code optimization             | Discipline | They win on deterministic engines; tie on LLM personas          |
| [14](./14-architecture.md)       | Solution architecture         | Discipline | We win on practice; they win on schema + diagrams               |
| [15](./15-benchmarking.md)       | Benchmarking                  | Discipline | Split — they win perf/LLM sense, we win market sense            |
| [16](./16-testing.md)            | Testing                       | Discipline | They win on capability; we win on invariant-targeting           |
| [17](./17-functional-testing.md) | Functional testing            | Discipline | **We win** (strongest category)                                 |
| [18](./18-logical-testing.md)    | Logical testing               | Discipline | We win on invariant precision; they win on generative coverage  |
| [19](./19-requirements.md)       | Requirements gathering        | Discipline | We win on fit/weight; they win on traceability                  |
| [20](./20-planning.md)           | Planning                      | Discipline | They win on durable task graphs; we win by design (lightweight) |
| [21](./21-design.md)             | Design                        | Discipline | We win on code-side enforcement; they win on the authoring seam |
| [22](./22-uiux.md)               | UI/UX                         | Discipline | We win on a11y-as-a-gate; they win on a11y depth                |

## Consolidated — top thing to adopt per category

The single highest-value, concrete borrow from each category. "Nothing" means the
file's honest verdict is that we already win and any borrow would be additive, not
corrective.

| #   | Category           | Top thing to adopt                                                                                                                                                                                |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Collections        | `skill-rules.json`-style **rule-based skill auto-activation** (keyword/path/intent) — our skills are invoked explicitly, never auto-triggered (ChrisWiles/claude-code-showcase).                  |
| 02  | Skills             | **Anti-rationalization tables** ("don't skip this because…") on each gate skill's SKILL.md (addyosmani/agent-skills); keep deferring to Superpowers for portable methodology.                     |
| 03  | Subagents          | Borrow on-stack specialist prompts (`nextjs-pro`/`postgres-pro`/`prisma-expert`/`code-reviewer`) as seed for **one optional stack-aware review agent**; keep the 2-agent minimalism.              |
| 04  | Hooks              | A **PostToolUse prompt-injection / secret-exposure scanner** — the output-side trust-boundary gap that push-time gitleaks doesn't cover (lasso + karanb192 pattern).                              |
| 05  | MCP                | Wire **upstash/context7** as a read-only dev-loop MCP for current Next 16 / Prisma 7 / AntD 6 / Auth.js v5 docs (chrome-devtools-mcp runner-up).                                                  |
| 06  | Frameworks         | wshobson's **`plugin-eval`** (static + LLM-semantic + Monte-Carlo agent evaluator) to harden our own skills/agents; task-master as a growth-path add.                                             |
| 07  | Scalability        | Wire **k6** (via k6-mcp-server) for agent-driven load tests + **crystaldba/postgres-mcp** for live EXPLAIN/index tuning, via `/scale-up`.                                                         |
| 08  | Maintainability    | Wire **webpro-nl/knip** (Next/Prisma-aware dead-code detector) into `/ship` so "no dead code" becomes a deterministic gate; **jscpd** as duplication companion.                                   |
| 09  | Quality            | Add quantified metrics to `/ship` (coverage threshold + duplication/complexity, SonarQube-style) and restructure `senior-code-reviewer` into named blocking lenses.                               |
| 10  | Security           | **TruffleHog `--only-verified`** as an optional high-signal `/audit` pass (live credential verification); pair with mintmcp's agent-read hook.                                                    |
| 11  | Speed of dev       | Borrow **wasp's declarative-CRUD ergonomics** — a thin "declare an entity, get typed CRUD" layer over `/scaffold-entity`.                                                                         |
| 12  | Performance        | Enable **Vercel Speed Insights** (zero-config CWV) + add **size-limit** as a `/ship` bundle budget — turns Pillar #1 (Speed) into a measured gate.                                                |
| 13  | Code optimization  | Wire **webpro-nl/knip** (has an MCP server) so "no dead code" is a deterministic `/ship` gate; **oraios/serena** (symbol-level refactor MCP) second.                                              |
| 14  | Architecture       | Enrich `ADR-TEMPLATE.md` with **MADR's schema** (decision drivers + per-option Good/Bad tradeoffs); add a Mermaid-C4 sketch to `/blueprint`.                                                      |
| 15  | Benchmarking       | **Nothing structural** — keep the market/competitive benchmark. Low-cost win: _read_ leoncuhk/awesome-llm-bench when refreshing the model tier.                                                   |
| 16  | Testing            | A **coverage gate in `/ship`** fed by **qodo-cover**-style AI test-generation (keploy record-replay as the API alternative) to close the thin-suite gap.                                          |
| 17  | Functional testing | Wire executeautomation's **codegen-session** so a `/manual-uat` walk emits a committed `*.uat.ts` regression spec — one-off findings become durable coverage.                                     |
| 18  | Logical testing    | Wire **dubzzz/fast-check** (small on-stack TS dev-dep) to convert hand-enumerated audit-scrub/zod invariants into property-based "for-all" assertions.                                            |
| 19  | Requirements       | Give `/blueprint` stories/acceptance-criteria stable **IDs + EARS phrasing** (`US1 → AC-1.1: WHEN … THE SYSTEM SHALL …`) for one-to-one QA traceability.                                          |
| 20  | Planning           | Wire **Superpowers `writing-plans`** as the sanctioned decomposition layer downstream of `/blueprint`; reserve task-master / Backlog.md for forks outgrowing one session.                         |
| 21  | Design             | A `/design-system` **design-to-code sub-recipe** ingesting a Figma frame via the Figma MCP, re-expressed on our shared primitives + tokens; a `tokens.json` DTCG source second.                   |
| 22  | UI/UX              | Add a **static a11y layer** — wire `eslint-plugin-jsx-a11y` into `/ship` and lift accessibility-agents' manual-review criteria (focus/ARIA/live-regions/keyboard, WCAG 2.2 AA) into `/design-qa`. |

## Highest-priority adoptions overall

Cross-cutting picks that recur or close the widest gaps, ordered by leverage:

1. **Close the measurement gaps in `/ship`.** Three categories independently point
   at the same fix: **knip** (dead-code, cats 08 & 13), a **coverage gate** (cat
   16), and **size-limit** bundle budgets (cat 12). Each turns a currently-manual
   pillar affirmation into a deterministic gate — the template's whole philosophy.
2. **Performance is the biggest genuine tooling gap** (cat 12). Vercel Speed
   Insights + size-limit is the cheapest way to make Pillar #1 (Speed) measured
   rather than asserted.
3. **Static a11y in `/ship`** (`eslint-plugin-jsx-a11y`, cat 22) — a11y is the
   thinnest UI/UX area and this makes it a pre-push gate, not just a `/design-qa`
   audit.
4. **Output-side trust boundary** (cat 04) — a PostToolUse prompt-injection /
   secret-exposure scanner covers what push-time gitleaks structurally cannot.
5. **Property-based invariants** (`fast-check`, cat 18) — converts the hand-written
   audit-scrub/zod contract assertions into generative "for-all" coverage.

Everything above is **additive to the prototype rail** — none requires
restructuring, consistent with the `/scale-up` growth-path philosophy. Categories
06, 10, 11, and 17 are the template's clearest wins; borrows there are polish, not
correction.
