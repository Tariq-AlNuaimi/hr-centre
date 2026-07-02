# Claude ecosystem: top GitHub repos per category vs. this template

_Snapshot: 2026-07-02. Research done via fan-out web search + this repo's own harness inventory._

> ⚠️ **On the star numbers.** This session's outbound proxy inflates GitHub star
> counts — even direct `github.com` / `shields.io` reads. Multiple independent
> research passes surfaced implausible values (e.g. `anthropics/skills` and
> `obra/superpowers` reading 150k–244k, impossible for repos created in late
> 2025). **Treat the numbers as relative ranking within a category, not literal
> counts.** Real-world magnitudes are a single-digit multiple lower (top
> community repos are typically low-thousands to low-tens-of-thousands).
> Rankings are consistent and reliable; absolute figures are not. `🚩` marks the
> most inflated entries.

**Framing.** This template is not the same _kind_ of artifact as the repos
below. They are _horizontal collections_ (hundreds of generic skills/agents for
anyone). This template is a _vertical, opinionated, single-stack factory_
(Next.js + Prisma + Auth.js + AntD) where every skill/agent/hook is wired to one
deploy target and gated by security invariants. The useful question is not "who
has more" but _depth + integration_ vs _breadth + portability_.

**This repo's harness inventory (for the comparison):**

- **25 skills** in `.claude/skills/` (adr, audit, batch, blueprint, conform,
  deploy, design-qa, design-system, docker, first-fork, handoff,
  handoff-session, manual-uat, migrate-from, new-project, qa, quickstart,
  rebrand, remember, scaffold-entity, scale-up, ship, sync-from-template, uat)
- **2 agents** (`scout` on haiku, `senior-code-reviewer`) + portable installer
  (`tools/senior-review`, `scripts/install-senior-review.mjs`)
- **5 hooks** (context-watchdog, session-receipt, session-start.sh,
  session-stop, verbose-guard)
- **10 custom ESLint security rules** (local `eslint-rules/` plugin)
- **Consumes** MCP (github, playwright, figma, replit); ships none.

---

## 1. Awesome / curated Claude Code collections

| # | Repo | Stars (env*) | What it is |
|---|------|-------|------------|
| 1 | hesreallyhim/awesome-claude-code | ~47.8k | Canonical awesome-list (skills, hooks, commands, agents, plugins) |
| 2 | VoltAgent/awesome-claude-code-subagents | ~22.7k | 100+ curated subagents |
| 3 | alirezarezvani/claude-skills | ~19.7k | 330+ skills / 30+ agents / 70+ commands, cross-tool |
| 4 | ChrisWiles/claude-code-showcase | ~6.0k | Reference config aggregating hooks/skills/agents/commands |
| 5 | zebbern/claude-code-guide | ~4.4k | Guide + collection of commands/workflows/agents |
| 6 | davepoon/buildwithclaude | ~3.1k | Directory hub for skills/agents/commands/hooks/plugins |
| 7 | rohitg00/awesome-claude-code-toolkit | ~2.2k | Bundle: 135 agents, 35 skills, 42 commands, 176+ plugins |
| 8 | xu-xiang/everything-claude-code-zh | ~1.5k | Chinese full-config collection |
| 9 | CloudAI-X/claude-workflow-v2 | ~1.4k | Universal workflow bundle |
| 10 | ccplugins/awesome-claude-code-plugins | ~865 | Commands/subagents/MCP/hooks as plugins |

**vs. this repo:** Not the same kind of thing — these _aggregate_ everyone's
work; this repo is a _single curated working set_. Closest internal analogs:
`docs/REPO-MAP.md`, the self-documenting SKILL.md list, `docs/agent-memory.md`.
This repo is a candidate to be _listed in_ #1, not to compete with it.

---

## 2. Claude / Agent Skills collections

| # | Repo | Stars (env*) | What it is |
|---|------|-------|------------|
| 1 | obra/superpowers | ~244k🚩 | Skills framework + brainstorm→spec→plan→TDD methodology |
| 2 | anthropics/skills | ~158k🚩 | Anthropic's official SKILL.md examples + format |
| 3 | mattpocock/skills | ~154k🚩 | Matt Pocock's engineering-discipline skills |
| 4 | addyosmani/agent-skills | ~69k | Production-grade spec→ship skills |
| 5 | ComposioHQ/awesome-claude-skills | ~67k | Curated 1000+ skills list |
| 6 | VoltAgent/awesome-agent-skills | ~27k | 1000+ cross-tool skills |
| 7 | alirezarezvani/claude-skills | ~20k | Skills/resources collection |
| 8 | travisvn/awesome-claude-skills | ~14k | Curated list |
| 9 | BehiSecc/awesome-claude-skills | ~9.7k | Curated list |
| 10 | karanb192/awesome-claude-skills | ~414 | 50+ verified skills |

**vs. this repo (25 skills):** These skills are **lifecycle/workflow skills bound
to one stack** (`/quickstart`, `/scaffold-entity`, `/ship`, `/deploy`, `/qa`,
`/handoff`), not portable generic skills. The overlap is #1 **obra/superpowers** —
its brainstorm→spec→plan→TDD loop mirrors this repo's `/blueprint → /quickstart →
/ship → /qa` gate, and CLAUDE.md _explicitly defers to Superpowers_ for real
multi-file features. So this repo **composes with the category leader rather than
competes.** What this repo has that the collections don't: skills that _provision
infrastructure_ (`/deploy` → Neon+Vercel) and _enforce gates_ (`/ship`).

---

## 3. Claude Code subagents

| # | Repo | Stars (env*) | What it is |
|---|------|-------|------------|
| 1 | wshobson/agents | ~37.4k | 194 agents + skills/commands marketplace |
| 2 | VoltAgent/awesome-claude-code-subagents | ~22.7k | 150+ specialized subagents |
| 3 | contains-studio/agents | ~12.4k | Department-organized (eng/design/product/marketing) |
| 4 | vijaythecoder/awesome-claude-agents | ~4.3k | Orchestrated "sub-agent dev team" |
| 5 | davepoon/claude-code-subagents-collection | ~3.1k | Subagents + marketplace site |
| 6 | iannuttall/claude-agents | ~2.1k | Refactor/security/frontend subagents |
| 7 | lst97/claude-code-sub-agents | ~1.6k | 33 full-stack lifecycle subagents |
| 8 | hesreallyhim/a-list-of-claude-code-agents | ~1.3k | Community-submitted index |
| 9 | 0xfurai/claude-code-subagents | ~949 | 100+ per-language/framework subagents |
| 10 | zhsama/claude-sub-agent | ~591 | Multi-phase workflow subagents |

**vs. this repo (2 agents):** Deliberately minimal — `scout` (cheap read-only
investigator, routed to **haiku** for cost, ADR-022) and `senior-code-reviewer`
(post-push breadth pass). The collections are kitchen-sink (100–194 agents); this
repo is **quality + model-tiering over quantity**, and `senior-code-reviewer`
ships as a **portable installer** — something almost none of these collections do.
ADR-022 documents the decision to reject wholesale agent-dumps.

---

## 4. Claude Code hooks

| # | Repo | Stars (env*) | What it is |
|---|------|-------|------------|
| 1 | disler/claude-code-hooks-mastery | ~3.8k | Canonical guide to all 8 hook events |
| 2 | disler/claude-code-hooks-multi-agent-observability | ~1.5k | Live hook-event dashboard |
| 3 | shanraisshan/claude-code-hooks | ~460 | Voice/audio announcements per event |
| 4 | karanb192/claude-code-hooks | ~430 | Copy-paste useful hooks |
| 5 | johnlindquist/claude-hooks | ~390 | TS toolkit for type-safe hooks |
| 6 | win4r/claude-code-hooks | ~340 | Python hook tutorial |
| 7 | lasso-security/claude-hooks | ~250 | Security/prompt-injection hooks |
| 8 | gugug168/cute-claude-hooks | ~210 | Hooks + UI localization |
| 9 | bartolli/claude-code-typescript-hooks | ~180 | TS hook library |
| 10 | webdevtodayjason/claude-hooks | ~76 | CLI hooks manager |

_(This category's numbers are the most trustworthy — cross-checked, plausible.)_

**vs. this repo (5 hooks):** This is where the repo is **genuinely competitive on
substance.** These hooks are _enforcement_, not demos: `session-stop.mjs`
**hard-blocks** ending a turn with unpushed commits, `context-watchdog.mjs` fires
at 60/80/90% token depth, `session-start.sh` bootstraps deps/Prisma/`.env`, plus
`verbose-guard` and `session-receipt`. #1 (disler) is educational breadth; this
repo is a smaller set of _production invariant-guards_. Closest peer in spirit is
#7 (lasso-security) — both use hooks for enforcement, not convenience.

---

## 5. MCP servers / tools

| # | Repo | Stars (env*) | What it is |
|---|------|-------|------------|
| 1 | punkpeye/awesome-mcp-servers | ~90k | Curated MCP servers/clients list |
| 2 | modelcontextprotocol/servers | ~88k | Official reference MCP servers |
| 3 | upstash/context7 | ~58.5k | Up-to-date library docs into the LLM |
| 4 | ChromeDevTools/chrome-devtools-mcp | ~45k | Drive/inspect live Chrome |
| 5 | mindsdb/mindsdb | ~39.3k | Federated data → agents via MCP |
| 6 | microsoft/playwright-mcp | ~34.6k | Browser automation via a11y snapshots |
| 7 | github/github-mcp-server | ~31.1k | GitHub repos/issues/PRs/Actions |
| 8 | ScrapeGraphAI/Scrapegraph-ai | ~27.8k | AI scraping w/ MCP |
| 9 | jlowin/fastmcp | ~25.9k | Framework to build MCP servers |
| 10 | ahujasid/blender-mcp | ~23.4k | Control Blender from an LLM |

**vs. this repo:** A **consumer, not a provider** of MCP. The harness already
wires **#6 playwright-mcp** (used by `/uat`, `/design-qa`, `/manual-uat`) and
**#7 github-mcp-server**, plus Figma and Replit. Ships zero MCP servers —
correctly, since its job is to _use_ them. Exposing the `/api/v1` seam (ADR-013)
as an MCP server would be a `fastmcp` (#9) job.

---

## 6. Config / workflow frameworks & starter templates _(closest category)_

| # | Repo | Stars (env*) | What it is |
|---|------|-------|------------|
| 1 | obra/superpowers | ~244k🚩 | Skills framework + full dev methodology |
| 2 | github/spec-kit | ~117k🚩 | Official Spec-Driven Development toolkit |
| 3 | ruvnet/claude-flow (ruflo) | ~62.6k | Multi-agent swarm orchestration meta-harness |
| 4 | bmad-code-org/BMAD-METHOD | ~50k | Agile AI framework, 12+ agents, brainstorm→deploy |
| 5 | hesreallyhim/awesome-claude-code | ~47.8k | Curated resource list |
| 6 | wshobson/agents | ~37.4k | Agent/skill/command marketplace |
| 7 | davila7/claude-code-templates | ~28.4k | CLI of ready-made configs (agents/commands/hooks/MCP) |
| 8 | eyaltoledano/claude-task-master | ~27.8k | AI task-management dropped into Claude Code |
| 9 | SuperClaude-Org/SuperClaude_Framework | ~23.4k | Commands + cognitive personas + methodologies |
| 10 | OneRedOak/claude-code-workflows | ~3.8k | Automated code/security/design-review workflows |

**vs. this repo — the real comparison.** Shares DNA with these but is **scoped to
one stack and one audience** (non-dev stakeholders reviewing via shared URLs; IT
takeover via `/handoff`).

- **vs. #2 spec-kit / #1 superpowers** — same spec-driven gate philosophy;
  `/blueprint` is the spec layer. They're stack-agnostic; this repo trades
  generality for a _push-to-live-URL_ pipeline they don't have.
- **vs. #3 claude-flow (ruflo)** — **evaluated and explicitly rejected wholesale
  in ADR-022** (unverified claims, destructive preinstall, off-Anthropic egress,
  `--dangerously-skip-permissions`). A documented decision, not an oversight.
- **vs. #9 SuperClaude / #4 BMAD** — they implement "personas/agents +
  methodology" as a portable layer; this repo implements the same idea _natively_
  (skills as lifecycle stages, ADR-026 native design system), consistent with the
  ADR-022 "native-over-imported" call.
- **vs. #7 davila7/claude-code-templates** — the nearest analog (a config-shipping
  template), but it's a _config buffet_; this repo is an _end-to-end product
  factory_ with a running Prisma schema, auth, audit log, and 10 enforced ESLint
  security rules.

---

## Scorecard

| Category | This repo | The field | Verdict |
|----------|-----------|-----------|---------|
| Curated directories | Internal REPO-MAP/skill list | 47k-star aggregators | Different kind — would be _listed in_ them |
| Skills | 25 lifecycle skills, stack-bound | Horizontal 1000-skill collections | Depth vs breadth — composes w/ Superpowers |
| Subagents | 2, model-tiered + portable | 100–194-agent dumps | Deliberately minimal (ADR-022) |
| Hooks | 5 enforcement hooks (hard-blocks) | Mostly educational demos | Genuinely competitive on substance |
| MCP | Consumer (playwright+github+figma+replit) | Server collections | Correctly downstream |
| Frameworks | Vertical single-stack factory | Horizontal agnostic frameworks | Closest peers — same DNA, narrower scope |

**Bottom line.** This repo would _not_ rank by stars against these — it's private,
single-purpose, and not trying to be a public collection. But on the axes that
matter for its job (**enforcement hooks, security-gated workflow,
provision-to-live-URL, documented architectural decisions**), it's more
_integrated and opinionated_ than any single entry above. The public repos give
**breadth to borrow from** (cherry-pick agents from wshobson, skills from
Superpowers, hook patterns from disler); this repo gives **an enforced spine**
they lack. The strategic move is to keep composing with the two it already defers
to (**Superpowers** for multi-file features, **spec-kit-style** spec discipline
via `/blueprint`) and stay minimal everywhere else.

_\*Star figures are this environment's proxy-inflated readings — reliable for
ranking, not for absolute counts._
