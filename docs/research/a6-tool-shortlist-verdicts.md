# A.6 — Operator Tool-Shortlist Verdicts

> Fulfils `docs/research/v2/PHASE-2-BACKLOG.md` §A.6 (research executed 2026-07-13).
> Lens (agent-memory 2026-07-11 directive): operator pain #1 = no design/architecture before
> execution, pain #2 = frontend quality — frontend/design tools are weighted heavily.
> Current stack baseline: Next 16 + Prisma 7 + Neon + Auth.js v5 + **Tailwind v4 + Radix/shadcn**
> (ADR-029; CLAUDE.md's "AntD 6" text is stale) + the `.claude` harness (`/design-system`,
> `/design-qa`, `docs/design-recipes.md`, shadcn MCP + chrome-devtools MCP already in `.mcp.json`).

## Verdict table

| Tool                               | Category              | What it does                                                                                                                                                          | vs current stack                                                                                                                                   | Recommendation    | Priority |
| ---------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------- |
| frontend-design plugin (Anthropic) | Frontend/design       | Official Claude Code plugin; forces an aesthetic commitment (purpose/tone/constraints/differentiation) before any UI code; ~300k installs                             | Complements `/design-system` (which enforces repo tokens/primitives but doesn't generate creative direction)                                       | **ADOPT**         | P1       |
| shadcn MCP                         | Frontend/design       | Registry browse/search/install of shadcn components via MCP                                                                                                           | Already wired (`shadcn@4.13.0 mcp` in `.mcp.json`) — parity confirmed                                                                              | **KEEP**          | —        |
| 21st.dev Magic MCP                 | Frontend/design       | v0-style UI component generation from a hosted component library                                                                                                      | Maintenance-only (last commit Feb 2026, 0 releases, npm stale ~11 mo); **unpatched prompt-injection advisory open 55+ days**                       | **SKIP**          | —        |
| ui-ux-pro-max skill                | Frontend/design       | Searchable databases of 50 styles/21 palettes/50 font pairings + design-system generator; freemium                                                                    | Overlaps `docs/design-recipes.md` + `app/tokens.css`; token-heavy; premium upsell                                                                  | **SKIP**          | —        |
| claude-design-skill (jiji262)      | Frontend/design       | Claude.ai's internal Design prompt repackaged for HTML artifacts (decks, landing pages, posters)                                                                      | Targets standalone HTML artifacts, not app UI on shadcn primitives                                                                                 | **SKIP**          | —        |
| impeccable (pbakaus)               | Frontend/design       | Design-vocabulary skill: 23 commands (polish/audit/critique/animate/bolder/quieter) + anti-patterns; 15k+ stars; built as an upgrade over Anthropic's frontend-design | Iterative-refinement verbs `/design-qa` lacks; overlaps frontend-design plugin — trial second, adopt one anti-slop layer, not three                | **ADD-AS-OPTION** | P2       |
| taste-skill (Leonxlnx)             | Frontend/design       | 13 anti-slop frontend taste skills, multi-agent-tool compatible                                                                                                       | Third overlapping anti-slop skill; skill-pile-up risk in context budget (ADR-019)                                                                  | **SKIP**          | —        |
| Vercel MCP                         | Frontend/design (ops) | Official remote MCP (OAuth, `https://mcp.vercel.com`): deployments, build logs, env vars, docs search                                                                 | `scripts/deploy.mjs` owns provisioning; MCP adds interactive deploy debugging; egress from web container must be verified                          | **ADD-AS-OPTION** | P2       |
| chrome-devtools MCP                | Frontend/design       | Browser inspection/perf/a11y tooling via MCP                                                                                                                          | Already wired (`chrome-devtools-mcp@1.5.0` in `.mcp.json`) — parity confirmed                                                                      | **KEEP**          | —        |
| OpenHands                          | Agent platform        | Self-hosted autonomous coding-agent platform (MIT core, commercial enterprise tier, 70k+ stars)                                                                       | Competes with, doesn't extend, the Claude Code harness                                                                                             | **SKIP**          | —        |
| Dify                               | Agent platform        | Full LLM-app platform (backend, admin UI, workers); 138k stars; modified Apache (multi-tenant restriction)                                                            | WS-5 already picked `lib/ai` + native Tool Runner; a second AI platform violates build-vs-buy minimalism                                           | **SKIP**          | —        |
| Langflow                           | Agent platform        | Visual LangChain/LangGraph flow builder (MIT)                                                                                                                         | Same as Dify; no LangChain in stack                                                                                                                | **SKIP**          | —        |
| Open WebUI                         | Agent platform        | Self-hosted ChatGPT-style UI (custom non-OSI license since Apr 2025)                                                                                                  | No self-hosted chat-UI need; license branding clause at 50+ users                                                                                  | **SKIP**          | —        |
| claudecodeui (siteboon)            | Agent platform        | Web/mobile GUI for Claude Code sessions                                                                                                                               | Two 2026 CVEs (unauthenticated RCE, command injection — patched, but the attack surface is the product); Claude Code web already covers remote use | **SKIP**          | —        |
| headroom                           | Agent platform        | Token-compression proxy/library/MCP for tool outputs (60–95% fewer tokens; Apache-2.0, active, 58k stars)                                                             | Directly serves ADR-019 token thrift, but inserts a proxy into the agent loop; experiment, not default                                             | **ADD-AS-OPTION** | P3       |
| free-llm-api-resources             | Agent platform        | Curated list of free LLM API providers (actively maintained)                                                                                                          | Reference bookmark only; AI layer is Anthropic via `lib/ai`                                                                                        | **SKIP**          | —        |
| Supabase                           | Data/infra            | Postgres + auth + realtime + storage backend platform                                                                                                                 | ADR-001/ADR-006 lock Vercel+Neon; Neon branching fits preview-per-branch; Supabase replaces Auth.js+Prisma patterns wholesale                      | **SKIP**          | —        |
| Coolify                            | Data/infra            | Self-hosted PaaS (v4 stable Apr 2026, Apache-2.0, 55k+ stars, preview deploys + per-branch DBs)                                                                       | Credible `/handoff` deploy target for IT teams that can't use Vercel; pairs with the mandatory Docker image (ADR-030/WS-1)                         | **ADD-AS-OPTION** | P3       |
| Maxun                              | Data/infra            | No-code web-scraping robots (AGPLv3, self-described beta)                                                                                                             | AGPL + immaturity; crawl4AI covers the extraction need better                                                                                      | **SKIP**          | —        |
| Stirling-PDF                       | Doc/OCR               | 50+ self-hosted PDF tools (MIT core, v2.9.x, 77k stars); Docker sidecar with private API                                                                              | Offloads PDF ops to a sidecar, preserving the no-pdfkit-in-serverless stance (ADR-006)                                                             | **ADD-AS-OPTION** | P3       |
| Unlimited-OCR (Baidu)              | Doc/OCR               | 3B MoE OCR model (MIT, Jun 2026): one-shot long-document parsing, open weights                                                                                        | Net-new capability for document-heavy forks (invoices/contracts); needs GPU inference hosting — off the Vercel rail                                | **ADD-AS-OPTION** | P3       |
| crawl4AI                           | Doc/OCR               | LLM-ready web crawler → clean Markdown (Apache-2.0, v0.9.1 Jul 2026, 50k+ stars, active)                                                                              | Net-new ingest capability for RAG/data forks; Python service, so recipe not dependency                                                             | **ADD-AS-OPTION** | P3       |
| browser-use                        | Doc/OCR               | Python autonomous browser-agent framework (MIT, 65k stars, own CDP runtime)                                                                                           | Playwright MCP + chrome-devtools MCP (both wired) already give the agent browser control at the right layer                                        | **SKIP**          | —        |

## Rationale per tool

### Frontend / design (pain point #2 — weighted heavily)

**frontend-design plugin — ADOPT (P1).** Anthropic's official plugin (~300k installs) attacks exactly the operator's failure mode: it blocks UI code until a design framework — purpose, audience, aesthetic direction — is committed, which is the frontend twin of the "design before execution" directive. It slots in front of `/design-system` (which enforces this repo's tokens, shared primitives, and RTL/dark/a11y rules) rather than replacing it; the repo's `no-raw-hex-color` and design-recipes remain binding. Zero-cost, officially maintained, one `/plugin install` away. Trial on the next real UI build and record the outcome in agent-memory.

**shadcn MCP — KEEP.** Already wired in `.mcp.json` (`shadcn@4.13.0 mcp`), matching the official `ui.shadcn.com/docs/mcp` guidance; supports multi-registry via `components.json`. Parity confirmed; no action beyond periodic version bumps.

**21st.dev Magic MCP — SKIP.** The project is effectively unmaintained (last commit a security bump in Feb 2026, zero tagged releases, npm packages ~11 months stale) and carries an open, unanswered prompt-injection supply-chain advisory: a malicious library component fetched by the MCP can inject instructions into the agent's context. That fails the template's security bar outright, independent of usefulness.

**ui-ux-pro-max — SKIP.** Its style/palette/font databases duplicate what `docs/design-recipes.md` + `app/tokens.css` + `brand.config.ts` already pin down — for internal tools we _want_ one opinionated system, not 50 selectable styles. Freemium upsell and a large context footprint make it a poor token-thrift citizen (ADR-019).

**claude-design-skill — SKIP.** It's Claude.ai's artifact-design prompt repackaged for standalone HTML decks/landing pages/posters. This template builds app UI on shadcn primitives inside Next; the skill's sweet spot is not our surface.

**impeccable — ADD-AS-OPTION (P2).** The strongest third-party design skill (15k+ stars in days, explicitly built as the upgrade to Anthropic's frontend-design), and its refinement verbs (`polish`, `audit`, `critique`, `quieter`) give the operator a vocabulary for iterating that `/design-qa`'s pass/fail scoring lacks. But it overlaps the frontend-design plugin heavily; adopt **one** anti-slop layer first (the official plugin), and reach for impeccable only if the quality gap persists. Build-vs-buy note: don't hand-roll a critique skill before trialing this.

**taste-skill — SKIP.** A third overlapping anti-slop skill (and community mergers like `design-taste` show the space is consolidating). Installing frontend-design + impeccable + taste-skill together just burns context and produces conflicting directives; one, at most two, wins.

**Vercel MCP — ADD-AS-OPTION (P2).** Official, OAuth-secured, remote (`claude mcp add --transport http vercel https://mcp.vercel.com`), initially read-only — good security posture. It doesn't replace `scripts/deploy.mjs` (provisioning) but adds what the scripts can't: interactive build-log/deployment debugging when a push fails on Vercel. Gate on an egress check from the web container before wiring into `.mcp.json`.

**chrome-devtools MCP — KEEP.** Wired at `chrome-devtools-mcp@1.5.0` with the browser-bridge proxy handling. Parity confirmed; it plus Playwright MCP fully cover `/design-qa`/`/uat` browser needs.

### Agent/AI platforms

**OpenHands — SKIP.** Impressive (v1.7, 72% SWE-Bench Verified with Sonnet, MIT core) but it's a _competing_ agent harness, and the enterprise controls this template cares about (RBAC, audit, guardrails) sit behind a commercial Polyform license. The operator's leverage is deepening the Claude Code harness, not running a second one.

**Dify — SKIP.** A full LLM-app platform (backend + admin UI + Celery workers) whose license restricts multi-tenant use. WS-5 already decided the AI layer: thin `lib/ai` over the Anthropic SDK/Tool Runner + pgvector + evals. Importing a platform to do what ~300 lines of `lib/ai` does inverts the template's build-vs-buy economics for this scale.

**Langflow — SKIP.** MIT and capable, but it's a visual builder for LangChain/LangGraph graphs — a stack this template deliberately doesn't use. Same verdict-logic as Dify.

**Open WebUI — SKIP.** Excellent self-hosted chat UI, but the template has no chat-frontend requirement, and its custom non-OSI license (branding lock-in at 50+ users, CLA) makes it an awkward dependency to inherit in forks that grow.

**claudecodeui — SKIP.** Actively developed, but it shipped an unauthenticated WebSocket RCE (CVE-2026-31975) and a command-injection CVE in 2026 — its whole product is a remote shell around your agent. Claude Code's own web/remote sessions already solve remote access with Anthropic-maintained security.

**headroom — ADD-AS-OPTION (P3).** Apache-2.0, very active, and its pitch (compress tool outputs/logs/RAG chunks 60–95% before the LLM) is literally ADR-019's goal. But it inserts a third-party proxy into the agent loop — a trust and debuggability cost — and the harness already attacks token spend via scout/haiku routing and `/batch`. Worth a contained experiment on long sessions; not a default.

**free-llm-api-resources — SKIP.** A well-maintained reference list, not adoptable tooling. Bookmark for eval-cost experiments; no action.

### Data / backend / infra

**Supabase — SKIP.** The 2026 consensus framing is "database (Neon) vs backend platform (Supabase)". This template _is_ the backend platform — Auth.js, Prisma services, audit, RBAC — so Supabase's auth/realtime/storage would displace working, gated code, and ADR-001/ADR-006 lock the Vercel+Neon rail (Neon branching maps to preview deploys). A stack swap needs a superseding ADR and has no driver.

**Coolify — ADD-AS-OPTION (P3).** v4 went stable April 2026 (55k+ stars, open-source, preview deploys with per-branch databases). It's the natural landing zone for `/handoff` when an IT team can't/won't use Vercel — and ADR-030 already makes the Docker image a mandatory artifact, so the delivery half exists. Action is one row in the `/scale-up`/handoff docs (cross-ref the 09-infra PaaS row), not any default change.

**Maxun — SKIP.** Self-described beta under AGPLv3 — a copyleft license the template shouldn't casually pull into forks. If a fork ever needs web-data extraction, crawl4AI (Apache-2.0, far more mature) is the recipe.

### Document / OCR / scraping

**Stirling-PDF — ADD-AS-OPTION (P3).** The template deliberately ships no PDF export (pdfkit fragile in serverless, ADR-006); Stirling-PDF resolves that _without_ touching the stance — a self-hosted Docker sidecar (MIT core, v2.9.x, 77k stars) with a private API the app can call for merge/convert/OCR/redact. Write it as a `/scale-up` recipe triggered by "a fork needs PDF output"; enterprise features (SSO, audit) are paid, but the core tools forks would use are free.

**Unlimited-OCR — SKIP-for-now leaning ADD-AS-OPTION (P3).** Genuinely notable (MIT, open weights, one-shot long-document parsing via R-SWA, 3B MoE with 500M active) and Rihal internal tools plausibly hit scanned-document workloads. But it requires GPU inference hosting the Vercel+Neon rail doesn't have. Verdict recorded as ADD-AS-OPTION at P3: a `/scale-up` recipe stub naming it as the OCR model _when_ a document-heavy fork appears with inference budget.

**crawl4AI — ADD-AS-OPTION (P3).** Best-in-class open-source LLM-ready crawling (Apache-2.0, v0.9.1 July 2026, active), and a true net-new capability — nothing in the template ingests external web data. It's Python, so it lands as a sidecar/pipeline recipe (Docker), not a dependency. Recipe row only; the build-vs-buy ledger answer for "we need scraping" is this, not hand-rolled fetch code.

**browser-use — SKIP.** Strong project (MIT, 65k stars, own CDP runtime since early 2026), but it's an autonomous Python browser-_agent framework_ — the wrong layer for us. The harness already gives the agent browser control via the wired Playwright MCP and chrome-devtools MCP, which is exactly the integration pattern 2026 comparisons recommend for coding agents.

## Top 3 actions

1. **Install the Anthropic `frontend-design` plugin** (`/plugin install frontend-design@claude-plugins-official`) and wire it into the UI workflow ahead of `/design-system` — official, maintained, and squarely aimed at pain point #2. Trial on the next real screen build; repo token/primitive rules stay binding; record the verdict in agent-memory.
2. **Hold `impeccable` as the single sanctioned follow-up design skill** if frontend-design alone doesn't close the quality gap — and explicitly skip ui-ux-pro-max / claude-design-skill / taste-skill / 21st Magic (the last on security grounds) so the design layer stays one skill deep.
3. **Add `/scale-up` recipe rows (no default deps): Coolify** (self-host deploy target at `/handoff`, pairs with the ADR-030 Docker image), **Stirling-PDF sidecar** (PDF ops without breaking ADR-006), and **crawl4AI (+ Unlimited-OCR stub)** for data-ingest/document-heavy forks. Optionally evaluate **Vercel MCP** (egress permitting) and a contained **headroom** token-thrift experiment.

## Sources (primary)

- https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design · https://claude.com/plugins/frontend-design
- https://github.com/21st-dev/magic-mcp (issue #46 prompt-injection advisory) · https://ui.shadcn.com/docs/mcp
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill · https://github.com/jiji262/claude-design-skill · https://github.com/pbakaus/impeccable · https://github.com/Leonxlnx/taste-skill
- https://vercel.com/docs/agent-resources/vercel-mcp · https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://github.com/OpenHands/OpenHands · https://github.com/langgenius/dify · https://github.com/langflow-ai/langflow · https://docs.openwebui.com/license/
- https://github.com/siteboon/claudecodeui (CVE-2026-31862, CVE-2026-31975) · https://github.com/headroomlabs-ai/headroom · https://github.com/cheahjs/free-llm-api-resources
- https://github.com/supabase/supabase · https://github.com/coollabsio/coolify · https://github.com/getmaxun/maxun
- https://github.com/Stirling-Tools/Stirling-PDF · https://github.com/baidu/Unlimited-OCR · https://github.com/unclecode/crawl4ai · https://github.com/browser-use/browser-use
