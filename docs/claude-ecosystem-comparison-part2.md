# Claude ecosystem — top repos by discipline (16 categories) vs. this template

_Snapshot: 2026-07-02. Companion to `claude-ecosystem-comparison.md` (the six
harness-structure categories). This file covers 16 **discipline** categories that
map onto the template's Five Pillars and lifecycle skills._

> ⚠️ **Star numbers are approximate magnitudes for ranking only.** This
> environment's proxy inflates GitHub counts (e.g. `obra/superpowers` and
> `affaan-m/everything-claude-code` read 100k–244k — implausible for late-2025
> repos). Trust the ranking tier, not the digits. Where a category's Claude-native
> ecosystem is thin, the tables include the prominent general-purpose tools that
> Claude skills/agents actually wrap (this is called out per-category).

**How this template maps** — each discipline is either **Enforced** (a `/ship` or
`/code-review` gate blocks on it), **Practiced** (a skill/agent does it but isn't
gate-blocking), or a **Gap** (no wired capability). Summary scorecard at the end.

---

## 1. Scalability

| #   | Repo                                    | ~Stars | What                                               |
| --- | --------------------------------------- | ------ | -------------------------------------------------- |
| 1   | wshobson/agents                         | ~37k   | `performance-engineer`/`database-optimizer` agents |
| 2   | grafana/k6                              | ~30k   | Load/scale testing (has community MCP)             |
| 3   | locustio/locust                         | ~27k   | Distributed load testing (community MCP)           |
| 4   | vitessio/vitess                         | ~19k   | MySQL horizontal sharding                          |
| 5   | citusdata/citus                         | ~11k   | Scale-out Postgres                                 |
| 6   | VoltAgent/awesome-claude-code-subagents | ~9k    | `postgres-pro`/`sql-pro` agents                    |
| 7   | ankane/pghero                           | ~8k    | Postgres slow-query / N+1 surfacing                |
| 8   | crystaldba/postgres-mcp                 | ~2.7k  | Index-tuning / EXPLAIN MCP for agents              |
| 9   | VoltAgent/awesome-agent-skills          | ~27k   | Cross-harness scaling skills                       |
| 10  | QAInsights/k6-mcp-server                | small  | Drive k6 load tests from Claude                    |

**vs. this repo — Enforced.** Pillar #4 (Scalable) is a **gate**: `/ship`'s
`scanScalability` checks every `.findMany(` call site for bound tokens
(take/skip/cursor/paginate) and hard-fails unbounded queries; list routes must
paginate, no N+1, bulk paths not N×1. The field above is _tooling_ (load-testers,
index advisors); this repo is _enforcement_ — it blocks unscalable code from
merging but doesn't ship a load-test rig. **Borrow:** `crystaldba/postgres-mcp`
(#8) or k6 via `/scale-up` if you ever need to validate real scale.

## 2. Maintainability

| #   | Repo                                    | ~Stars   | What                                     |
| --- | --------------------------------------- | -------- | ---------------------------------------- |
| 1   | wshobson/agents                         | ~37k     | `refactoring`/`legacy-modernizer` agents |
| 2   | astral-sh/ruff                          | ~33k     | Fast Python linter/formatter             |
| 3   | biomejs/biome                           | ~17k     | Unified JS/TS lint+format                |
| 4   | semgrep/semgrep                         | ~11k     | Anti-pattern static analysis             |
| 5   | SonarSource/sonarqube                   | ~9k      | Tech-debt / maintainability platform     |
| 6   | VoltAgent/awesome-claude-code-subagents | ~9k      | `refactoring-specialist` agent           |
| 7   | webpro-nl/knip                          | ~7.5k    | Dead-code / unused-export detector       |
| 8   | kucherenko/jscpd                        | ~5k      | Copy-paste duplication detector          |
| 9   | SonarSource/sonarqube-mcp-server        | hundreds | Sonar findings into Claude               |
| 10  | dl-ezo/claude-code-sub-agents           | ~1.5k    | 35 subagents incl. refactoring           |

**vs. this repo — Enforced + Practiced.** Pillar #3 (Maintainable) gates on "reuse
existing primitives (check `docs/REPO-MAP.md` first), typed, no dead code, small
forward-compatible migrations." `/simplify` and `/code-review` do the refactoring
pass; ESLint enforces conventions. The repo is _opinionated-single-stack_, so it
sidesteps the multi-language tooling above — its maintainability comes from
narrow surface + review, not Sonar-style scoring.

## 3. Quality

| #   | Repo                                    | ~Stars | What                                             |
| --- | --------------------------------------- | ------ | ------------------------------------------------ |
| 1   | anthropics/claude-code                  | ~115k  | Ships `/code-review` (parallel review subagents) |
| 2   | astral-sh/ruff                          | ~44k   | Fast Python linter/formatter                     |
| 3   | wshobson/agents                         | ~37k   | `code-reviewer`/`qa-expert`/`architect-review`   |
| 4   | eslint/eslint                           | ~26k   | The JS/TS quality gate agents shell out to       |
| 5   | biomejs/biome                           | ~18k   | Lint + format single tool                        |
| 6   | VoltAgent/awesome-claude-code-subagents | ~11k   | `04-quality-security` agent category             |
| 7   | SonarSource/sonarqube                   | ~9k    | 6,500-rule quality platform                      |
| 8   | rohitg00/awesome-claude-code-toolkit    | ~2-4k  | Review + audit workflows                         |
| 9   | Storybloq/lenses                        | <1k    | Multi-lens review MCP (8 parallel reviewers)     |
| 10  | hyhmrright/logic-lens                   | <1k    | Semantic-bug review skills                       |

**vs. this repo — Enforced (strong).** This is a top area. `/qa` orchestrates
three gated tiers (design → functional → UAT); `/ship` runs typecheck/lint/tests/
build/secret-scan; the native `/code-review` is the pre-push diff gate and
`senior-code-reviewer` is the post-push breadth pass — the same parallel-reviewer
pattern as #1 `anthropics/claude-code` and #9 `Storybloq/lenses`, but wired as
mandatory gates, not optional invocations. Plus 10 ESLint rules at `error`.

## 4. Security

| #   | Repo                                   | ~Stars | What                                        |
| --- | -------------------------------------- | ------ | ------------------------------------------- |
| 1   | aquasecurity/trivy                     | ~36k   | CVE/misconfig/secret/SBOM scanner           |
| 2   | gitleaks/gitleaks                      | ~21k   | Secret scanning (**this repo uses it**)     |
| 3   | trufflesecurity/trufflehog             | ~20k   | Secret scanning w/ live verification        |
| 4   | semgrep/semgrep                        | ~15k   | SAST + official MCP (**this repo uses it**) |
| 5   | anthropics/claude-code-security-review | ~4.3k  | Official AI `/security-review` Action       |
| 6   | semgrep/mcp                            | ~700   | Semgrep MCP for Claude                      |
| 7   | AgentSecOps/SecOpsAgentKit             | <1k    | 25+ security skills                         |
| 8   | fortify/skills                         | <1k    | Fortify SAST/DAST/SCA skills                |
| 9   | transilienceai/communitytools          | <1k    | Pentest/bug-bounty skills                   |
| 10  | mintmcp/agent-security                 | <1k    | Pre-commit secret-scan hooks                |

**vs. this repo — Enforced (strongest area).** Security is the hardest-gated
pillar: 10 custom ESLint rules at `error` (auth-wrapper, no-raw-SQL, no-secret-log,
no-unaudited-bulk-write, no-restricted-export-column, …), the `/audit` skill = the
same **gitleaks (#2) + npm audit + Semgrep (#4)** stack these repos provide,
mandatory `withAuth`/zod on every route, an automatic audit log, and `SECURITY.md`

- findings register. The repo's `/code-review` + `/security-review` mirror #5
  `anthropics/claude-code-security-review`. It _consumes_ the category's top tools
  rather than reinventing them.

## 5. Speed of development

| #   | Repo                             | ~Stars | What                                        |
| --- | -------------------------------- | ------ | ------------------------------------------- |
| 1   | anthropics/claude-code           | ~135k  | The agentic CLI itself                      |
| 2   | AntonOsika/gpt-engineer          | ~55k   | Whole codebase from one prompt              |
| 3   | hesreallyhim/awesome-claude-code | ~48k   | Curated hub                                 |
| 4   | wshobson/agents                  | ~37k   | Scaffolding agent marketplace               |
| 5   | t3-oss/create-t3-app             | ~29k   | Scaffolds typesafe full-stack Next.js       |
| 6   | nrwl/nx                          | ~29k   | Monorepo generators                         |
| 7   | VoltAgent/awesome-agent-skills   | ~27k   | 1000+ build-accelerating skills             |
| 8   | wasp-lang/wasp                   | ~18.5k | Config-driven full-stack framework          |
| 9   | stackblitz/bolt.new              | ~16k   | Prompt → deploy in-browser                  |
| 10  | wasp-lang/open-saas              | ~15k   | Production SaaS boilerplate (Claude plugin) |

**vs. this repo — this IS the product.** The template's core value prop lives
here: `/quickstart` (one paragraph → live URL in ~10 min), `/scaffold-entity`
(Prisma + zod + routes + pages + nav in one command), `/new-project`/`/deploy`
(GitHub + Neon + Vercel in ~3 min). It's a direct peer to #5 `create-t3-app`, #8
`wasp`, and #10 `open-saas` — same "idea-to-app" niche (Next.js/Prisma/Auth) — but
with the **entire Claude Code harness (skills, gates, hooks) baked in**, which none
of those ship. This is where the repo would genuinely compete.

## 6. Performance optimization

| #   | Repo                                 | ~Stars | What                                |
| --- | ------------------------------------ | ------ | ----------------------------------- |
| 1   | GoogleChrome/lighthouse              | ~30.5k | Perf / Core Web Vitals audits       |
| 2   | aidenybai/react-scan                 | ~21.6k | Detect problematic React renders    |
| 3   | aidenybai/million                    | ~17.7k | Optimizing React compiler           |
| 4   | QwikDev/partytown                    | ~13.7k | Offload 3rd-party scripts to worker |
| 5   | webpack/webpack-bundle-analyzer      | ~12.7k | Bundle-size treemap                 |
| 6   | welldone-software/why-did-you-render | ~12.5k | Surface wasteful re-renders         |
| 7   | GoogleChrome/web-vitals              | ~8.5k  | Measure LCP/INP/CLS                 |
| 8   | ai/size-limit                        | ~6.9k  | CI bundle-size budgets              |
| 9   | jlfwong/speedscope                   | ~6.7k  | Flamegraph profiler viewer          |
| 10  | clinicjs/node-clinic                 | ~5.9k  | Node.js profiling suite             |

**vs. this repo — Practiced, tooling GAP.** Pillar #1 (Speed) enforces _principles_
— RSC reads, no needless round-trips, debounced inputs, bounded payloads — at
review time. But no automated perf tooling is wired: no Lighthouse, web-vitals, or
bundle budget. **Biggest tooling gap of the 16.** **Borrow:** `lighthouse` (#1) /
`size-limit` (#8) via `/scale-up`, or Sentry for runtime perf.

## 7. Code optimization

| #   | Repo                                    | ~Stars  | What                                         |
| --- | --------------------------------------- | ------- | -------------------------------------------- |
| 1   | affaan-m/everything-claude-code         | ~100k🚩 | `refactor-cleaner` agent + `/refactor-clean` |
| 2   | astral-sh/ruff                          | ~48k    | Linter/formatter w/ autofix                  |
| 3   | wshobson/agents                         | ~37k    | `code-refactorer`/`performance-optimizer`    |
| 4   | oraios/serena                           | ~26k    | Symbol-level semantic refactoring MCP        |
| 5   | biomejs/biome                           | ~25k    | Lint+format autofix                          |
| 6   | VoltAgent/awesome-claude-code-subagents | ~23k    | `refactoring-specialist`                     |
| 7   | ast-grep/ast-grep                       | ~15k    | AST structural search/rewrite                |
| 8   | webpro-nl/knip                          | ~12k    | Dead-code detector                           |
| 9   | kucherenko/jscpd                        | ~5.8k   | Duplication detector                         |
| 10  | codemod/codemod                         | ~1k     | Large-scale codemod engine                   |

**vs. this repo — Practiced.** `/simplify` (reuse/efficiency/altitude cleanups)
and `/code-review` cover the refactoring pass natively — same intent as #1's
`/refactor-clean` and #4 `serena`. `/batch` runs codemod-style per-file jobs like
#10. No standalone dead-code scanner (`knip`) is wired, but the "no dead code"
pillar catches it at review.

## 8. Solution architecture

| #   | Repo                                             | ~Stars  | What                                   |
| --- | ------------------------------------------------ | ------- | -------------------------------------- |
| 1   | affaan-m/everything-claude-code                  | ~100k🚩 | `architect` agent + `planner`          |
| 2   | wshobson/agents                                  | ~37k    | `architect-review`/`backend-architect` |
| 3   | VoltAgent/awesome-claude-code-subagents          | ~23k    | Architecture agent category            |
| 4   | joelparkerhenderson/architecture-decision-record | ~16k    | Canonical ADR templates                |
| 5   | npryce/adr-tools                                 | ~5.5k   | CLI for numbered Markdown ADRs         |
| 6   | adr/madr                                         | ~2.3k   | MADR modern ADR format                 |
| 7   | thomvaill/log4brains                             | ~1.5k   | ADR docs-as-code + web UI              |
| 8   | structurizr/java                                 | ~1.1k   | C4-model diagrams-as-code              |
| 9   | 0xfurai/claude-code-subagents                    | ~0.9k   | Architecture/system-design specialists |
| 10  | supatest-ai/awesome-claude-code-sub-agents       | ~0.2k   | `clean-architecture-expert` agents     |

**vs. this repo — Practiced (strong).** The repo runs a **mature ADR practice** —
26+ records in `docs/decisions/`, the `/adr` skill (same job as #5 `adr-tools`,
#4/#6 templates), and every Ask-before change requires a superseding ADR. Plus
`/blueprint` (architecture sketch), the `Plan` agent, and `EnterPlanMode` for
auto-planning high-blast-radius work. It has the _decision-record discipline_ these
repos provide, natively.

## 9. Benchmarking

| #   | Repo                       | ~Stars | What                              |
| --- | -------------------------- | ------ | --------------------------------- |
| 1   | Aider-AI/aider             | ~40k   | Polyglot code-editing leaderboard |
| 2   | wg/wrk                     | ~38k   | HTTP perf benchmarking            |
| 3   | SWE-bench/SWE-bench        | ~32k   | Canonical LLM-coding benchmark    |
| 4   | grafana/k6                 | ~28k   | Scriptable load benchmarking      |
| 5   | locustio/locust            | ~26k   | Distributed load benchmarking     |
| 6   | sharkdp/hyperfine          | ~24k   | CLI statistical benchmarking      |
| 7   | SWE-bench/SWE-agent        | ~16k   | Agent scaffold for SWE-bench      |
| 8   | ruvnet/claude-flow         | ~8k    | Built-in SWE-bench eval harness   |
| 9   | leoncuhk/awesome-llm-bench | ~1k    | Leaderboard aggregator            |
| 10  | jimmc414/…_swebench        | small  | Benchmark Claude vs Codex/Gemini  |

**vs. this repo — Practiced (different sense).** The repo's benchmarking is
**market/competitive**, not perf/LLM: CLAUDE.md mandates "Market benchmark before
building" (web-search existing products, trade-offs, a spec "market scan" section),
and `/uat` Full mode does a "peer + enterprise benchmark." It has _no_ perf
benchmarking (`wrk`/`k6`/`hyperfine`) or SWE-bench harness — correctly, since it
builds prototypes rather than benchmarking models.

## 10. Testing

| #   | Repo                                    | ~Stars     | What                                        |
| --- | --------------------------------------- | ---------- | ------------------------------------------- |
| 1   | microsoft/playwright                    | ~78k       | Cross-browser E2E (**this repo drives it**) |
| 2   | cypress-io/cypress                      | ~48k       | E2E with time-travel                        |
| 3   | jestjs/jest                             | ~44k       | JS unit test framework                      |
| 4   | SeleniumHQ/selenium                     | ~31k       | WebDriver automation                        |
| 5   | testing-library/*                       | ~19k       | User-centric UI testing                     |
| 6   | keploy/keploy                           | ~17k       | eBPF record-replay + AI test-gen            |
| 7   | vitest-dev/vitest                       | ~14k       | Vite-native unit tests                      |
| 8   | pytest-dev/pytest                       | ~12k       | Python testing                              |
| 9   | VoltAgent/awesome-claude-code-subagents | ~several k | `test-automator`/`qa-expert`                |
| 10  | qodo-ai/qodo-cover                      | ~5k        | AI test-gen + coverage                      |

**vs. this repo — Enforced.** `/ship` runs the contract suite (`npm test`) +
component tests on every push and hard-fails on red. The repo uses Vitest-style
unit/component tests + Playwright (#1) for browser flows. Testing is gate-blocking,
though the test _volume_ is modest (contract + component, not exhaustive coverage).

## 11. Functional testing

| #   | Repo                                    | ~Stars | What                                   |
| --- | --------------------------------------- | ------ | -------------------------------------- |
| 1   | microsoft/playwright                    | ~78k   | E2E engine                             |
| 2   | browser-use/browser-use                 | ~78k   | AI-agent browser automation            |
| 3   | cypress-io/cypress                      | ~48k   | Front-end E2E                          |
| 4   | microsoft/playwright-mcp                | ~34k   | Playwright MCP (**this repo uses it**) |
| 5   | SeleniumHQ/selenium                     | ~32k   | Browser automation                     |
| 6   | VoltAgent/awesome-claude-code-subagents | ~20k   | `qa-expert` agent                      |
| 7   | executeautomation/mcp-playwright        | ~4-5k  | Playwright MCP variant                 |
| 8   | cucumber/cucumber-js                    | ~5k    | BDD/Gherkin                            |
| 9   | lackeyjb/playwright-skill               | <1k    | Claude skill: writes+runs Playwright   |
| 10  | willmarple/playwright-skill             | <1k    | Claude agentic browser-QA skill        |

**vs. this repo — Practiced (strong, Claude-native).** `/uat` (lean smoke + full
deep audit), `/manual-uat` (agent acts as a real user, happy + worst path, live
RBAC), and `/design-qa` all drive **`microsoft/playwright-mcp` (#4)** directly —
exactly the Claude-native functional-testing surface these skills (#9/#10) provide,
but integrated into the QA gate with a scored rubric.

## 12. Logical testing

| #   | Repo                       | ~Stars | What                            |
| --- | -------------------------- | ------ | ------------------------------- |
| 1   | jestjs/jest                | ~44k   | Unit/assertion/snapshot         |
| 2   | vitest-dev/vitest          | ~15k   | Vite-native unit tests          |
| 3   | HypothesisWorks/hypothesis | ~8k    | Property-based (Python)         |
| 4   | dubzzz/fast-check          | ~4.6k  | Property-based (JS/TS)          |
| 5   | rocq-prover/rocq (Coq)     | ~5k    | Theorem prover                  |
| 6   | tlaplus/tlaplus            | ~2.4k  | TLA+ model checker              |
| 7   | proptest-rs/proptest       | ~2k    | Property-based (Rust)           |
| 8   | flyingmutant/rapid         | ~1k    | Property-based (Go)             |
| 9   | matlugert/tdd-skill        | <1k    | Claude RED→GREEN→REFACTOR skill |
| 10  | glebis/claude-skills       | <1k    | Multi-agent TDD skill           |

**vs. this repo — Practiced, partial GAP.** The repo has **invariant/contract
tests** — `tests/contracts/audit-scrub.test.ts` asserts the audit-scrub invariant,
zod validates business logic at every boundary — which is logical testing of the
security invariants. But **no property-based testing** (`fast-check` #4) is wired.
**Borrow:** `fast-check` would pair well with the existing contract suite for the
zod validators. TDD discipline (#9/#10) is available via Superpowers.

## 13. Requirements gathering

| #   | Repo                                  | ~Stars  | What                                   |
| --- | ------------------------------------- | ------- | -------------------------------------- |
| 1   | obra/superpowers                      | ~150k🚩 | `brainstorming` skill → design doc     |
| 2   | github/spec-kit                       | ~117k🚩 | `/specify` intent → executable spec    |
| 3   | Fission-AI/OpenSpec                   | ~58k?   | SDD change-proposals                   |
| 4   | bmad-code-org/BMAD-METHOD             | ~50k    | Analyst/PM agents → PRDs, stories      |
| 5   | SuperClaude-Org/SuperClaude_Framework | ~23k    | Requirements/brainstorm personas       |
| 6   | buildermethods/agent-os               | ~5k     | Standards + "write better specs"       |
| 7   | gotalab/cc-sdd                        | ~3.5k   | Approved-spec Agent Skills             |
| 8   | SpillwaveSolutions/sdd-skill          | <1k     | Spec-Kit workflow skill                |
| 9   | FredAntB/Spec-Driven-Development      | <1k     | Generates requirements/design/tasks.md |
| 10  | angelsen/claude-kiro                  | niche   | Kiro-style requirements SDD            |

**vs. this repo — Practiced (strong).** `/blueprint` is the repo's requirements
gate: user stories + happy/worst scenarios + architecture sketch + tier + open
questions resolved via `AskUserQuestion`, committed to `docs/blueprints/`. Same job
as #2 `spec-kit /specify` and #1 Superpowers `brainstorming` — and CLAUDE.md
**explicitly defers to Superpowers** for real multi-file features. It's a spec-driven
shop already.

## 14. Planning

| #   | Repo                                  | ~Stars  | What                                      |
| --- | ------------------------------------- | ------- | ----------------------------------------- |
| 1   | obra/superpowers                      | ~150k🚩 | `writing-plans` → bite-size tasks         |
| 2   | github/spec-kit                       | ~117k🚩 | `/plan` + `/tasks`                        |
| 3   | ruvnet/claude-flow (ruflo)            | ~58k    | Swarm task planning                       |
| 4   | bmad-code-org/BMAD-METHOD             | ~50k    | Shards PRD → dev stories                  |
| 5   | eyaltoledano/claude-task-master       | ~28k    | PRD → dependency-ordered task graph (MCP) |
| 6   | SuperClaude-Org/SuperClaude_Framework | ~23k    | Architect/planner personas                |
| 7   | MrLesk/Backlog.md                     | ~5.9k   | Markdown Kanban in git (MCP)              |
| 8   | buildermethods/agent-os               | ~5k     | Spec-to-tasks planning                    |
| 9   | gotalab/cc-sdd                        | ~3.5k   | Specs → planned autonomous impl           |
| 10  | iannuttall/claude-agents              | ~2.1k   | `project-task-planner` subagent           |

**vs. this repo — Practiced, partial.** The repo has **plan discipline**:
`EnterPlanMode` + the `Plan` agent + the CLAUDE.md "auto-plan high blast-radius /
ambiguous work" rule, with `/blueprint` as the requirements half. But it has no
persistent **task-graph** decomposition (#5 `claude-task-master`, #4 BMAD) or Kanban
(#7 `Backlog.md`). For a solo-operator prototype rail that's by design — but if
projects grow, `claude-task-master` is the natural add.

## 15. Design

| #   | Repo                                     | ~Stars | What                            |
| --- | ---------------------------------------- | ------ | ------------------------------- |
| 1   | penpot/penpot                            | ~51k   | OSS Figma alternative           |
| 2   | GLips/Figma-Context-MCP                  | ~14k   | De-facto design-to-code MCP     |
| 3   | superdesigndev/superdesign               | ~6k    | AI design agent in Claude Code  |
| 4   | amzn/style-dictionary                    | ~4.7k  | Design-tokens build system      |
| 5   | tokens-studio/figma-plugin               | ~1.6k  | Design-token management         |
| 6   | southleft/figma-console-mcp              | ~1.3k  | Token sync MCP                  |
| 7   | arinspunk/claude-talk-to-figma-mcp       | ~440   | Claude reads/modifies Figma     |
| 8   | HermeticOrmus/design-mastery-claude-code | <200   | Brand/visual-design plugin      |
| 9   | gregorymm/design-tokens                  | <100   | Figma → CSS tokens plugin       |
| 10  | senlindesign/claude2figma                | ~40    | Design-system compliance skills |

**vs. this repo — Practiced (strong).** `/design-system` (proactive, build-it-right
front half) + `/design-qa` (reactive audit) run off `docs/design-recipes.md`, an
AntD theme, and `app/tokens.css` **design tokens** — the same tokens discipline as
#4 `style-dictionary`, enforced by the `no-raw-hex-color` ESLint rule (ADR-015,
ADR-026 native design system). The **Figma MCP is available** in this environment
(#2/#7 equivalent) for design-to-code if needed.

## 16. UI/UX

| #   | Repo                                  | ~Stars | What                               |
| --- | ------------------------------------- | ------ | ---------------------------------- |
| 1   | nextlevelbuilder/ui-ux-pro-max-skill  | ~90k🚩 | Design-intelligence skill          |
| 2   | shadcn-ui/ui                          | ~87k   | Accessible React components + MCP  |
| 3   | anthropics/skills (frontend-design)   | ~66k   | Official anti-generic UI skill     |
| 4   | leonxlnx/taste-skill                  | ~37k   | "Good taste" anti-boring-UI skill  |
| 5   | wandb/openui                          | ~21k   | NL → live UI (open-source v0)      |
| 6   | 21st-dev/magic-mcp                    | ~4.9k  | "v0 in your IDE" component MCP     |
| 7   | Jpisnice/shadcn-ui-mcp-server         | ~2.8k  | shadcn component context MCP       |
| 8   | HermeticOrmus/LibreUIUX-Claude-Code   | ~70    | 67-agent UI/UX system              |
| 9   | Community-Access/accessibility-agents | <1k    | WCAG 2.2 AA review agents          |
| 10  | airowe/claude-a11y-skill              | <1k    | axe-core accessibility audit skill |

**vs. this repo — Practiced (strong).** `/design-system` builds UI right the first
time (one accent, one primary action, real empty/loading/error states, RTL + dark,
on-token) and `/design-qa` runs **axe** accessibility audits — exactly what #9/#10
a11y agents provide, plus the design-intelligence intent of #1/#3/#4. The repo uses
**Ant Design 6** as its component system where the field uses shadcn (#2). The
`docs/uat-rubric.md` UI Definition-of-Done is its "good taste" gate.

---

## Scorecard: this template across all 16 disciplines

| #   | Discipline            | Coverage           | Mechanism                                         |
| --- | --------------------- | ------------------ | ------------------------------------------------- |
| 1   | Scalability           | **Enforced**       | `/ship` unbounded-query scan; pagination pillar   |
| 2   | Maintainability       | **Enforced**       | Pillar #3 + REPO-MAP + `/simplify`                |
| 3   | Quality               | **Enforced ★**     | `/qa` tiers + `/code-review` + senior review      |
| 4   | Security              | **Enforced ★★**    | 10 ESLint rules + `/audit` (gitleaks/semgrep/npm) |
| 5   | Speed of dev          | **Core product ★** | `/quickstart` `/scaffold-entity` `/deploy`        |
| 6   | Performance opt       | **GAP (tooling)**  | principles only; no Lighthouse/web-vitals         |
| 7   | Code opt              | **Practiced**      | `/simplify` `/code-review` `/batch`               |
| 8   | Solution architecture | **Practiced ★**    | ADRs + `/adr` + `/blueprint` + Plan agent         |
| 9   | Benchmarking          | **Partial**        | market benchmark only; no perf/SWE-bench          |
| 10  | Testing               | **Enforced**       | `/ship` contract + component suites               |
| 11  | Functional testing    | **Practiced ★**    | `/uat` `/manual-uat` on Playwright MCP            |
| 12  | Logical testing       | **Partial GAP**    | contract/zod tests; no property-based             |
| 13  | Requirements          | **Practiced ★**    | `/blueprint` (+ defers to Superpowers)            |
| 14  | Planning              | **Partial**        | plan-mode + Plan agent; no task-graph             |
| 15  | Design                | **Practiced ★**    | `/design-system` + tokens + `no-raw-hex`          |
| 16  | UI/UX                 | **Practiced ★**    | `/design-qa` axe + AntD + uat-rubric              |

★ = a genuine strength; ★★ = strongest. **Three real gaps worth closing** if a fork
grows: (6) **performance tooling** — wire Lighthouse / `size-limit` via `/scale-up`;
(12) **property-based testing** — add `fast-check` to the contract suite; (14)
**task-graph planning** — adopt `eyaltoledano/claude-task-master` for larger builds.
Everything else is either enforced at a gate or practiced by a skill.

**Overall:** the template is **enforcement-first, single-stack, and Claude-native**.
Where the field ships broad tooling for anyone, this repo bakes the _discipline_ into
`/ship` + `/code-review` gates for one stack. It's strongest exactly where it should
be — security, quality, speed-of-dev, and the design/QA loop — and its gaps are all
in optional "growth" tooling (perf, property-based tests, heavy planning) it can
`/scale-up` into on demand.

_\*Star figures are proxy-inflated readings — reliable for ranking, not counts._
