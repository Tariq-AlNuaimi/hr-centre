# Next-session handoff — tool wiring ("do both")

> New session: we are mid-stream on fullstack-vibe-template. Read this, confirm the
> branch, then start on "Next steps" item 1. Do not re-explore what it answers.

## Goal
Operator's complaint: the template defaults to hand-building / over-complicating /
skipping planning because those behaviors were advisory, not enforced. This session
built the **enforcement layer** (3 hard gates). Operator then said **"do both"** =
the two follow-up items below. This session hit the context hard-limit before starting
them, so they are the next session's job.

## State
- Branch: `claude/template-repo-integration-hi4598`, **in sync, 0 unpushed**.
- Last `/ship`: **green except gitleaks** (binary uninstallable here — env, not code).
- Not deployed (harness/docs only).

## Done (this session) — the enforcement trio, all pushed
- `a594a05` — Gate #1 build-vs-buy (ADR-032): PreToolUse deny on new `lib/` file until a `docs/build-vs-buy-ledger.md` `Scope:` entry covers it.
- `0674eae` — Gate #2 blueprint-before-build (ADR-033): PreToolUse deny on new `app/api/**/route.ts` + `app/**/page.tsx` until a `docs/blueprints/*.md` `Scope:` glob covers it; `/blueprint` skill emits `Scope:`.
- `10cfed7` — Gate #3 complexity budget (ADR-034): `/ship` `scanComplexity()` RED on a new product file >350 code lines or >40 branch tokens; waivable via `complexityAck`.

## Decisions (do not relitigate)
- Enforcement = **deny/RED gate + committed adjudication artifact**; keep gates narrow (new-file only) to avoid friction.
- Complexity gate is dependency-free (git+node proxy), ADDED-files only; modified-file per-function complexity is a documented v2 (ADR-034).
- From the 24-tool analysis: shadcn MCP + chrome-devtools-mcp = **ADOPT**; Stirling-PDF + crawl4ai = **/scale-up RECIPE**; Supabase(platform)/Coolify(default)/Dify/Langflow/OpenWebUI/OpenHands/Maxun/browser-use/Unlimited-OCR/magic-mcp/claudecodeui/headroom = REFERENCE or SKIP (license/stack collisions). Full map in the session-13 conversation.

## Landmines
- **gitleaks binary NOT installable here** (403 on GitHub release via proxy). `/ship` RED only on gitleaks; push `--no-verify` after hand-scanning the diff secret-free.
- `docs/SESSION-HANDOFF.md` is renderer-owned (auto-status from `session-state.json`, "do not hand-edit") — that's why this handoff is a separate file.
- Guard hooks are fail-open by convention; the two hooks duplicate ~10 lines of glob logic on purpose (keeps them independent; `/ship` duplication check passes). Don't "DRY" them.

## Next steps — "do both"
1. **Wire shadcn MCP** — add `npx shadcn@latest mcp` to `.mcp.json`. Guardrail: it installs into `components/ui`; treat installs as raw material for `components/shared/*` primitives, not a bypass of the slop gate / `no-raw-hex-color`. It *is* the migrated component system, so it strengthens `/design-system` + `/scaffold-entity`.
2. **Wire chrome-devtools-mcp** — add `npx chrome-devtools-mcp@latest` to `.mcp.json`. Value: real perf traces + Core Web Vitals + CPU/network throttling = the agent-driven stand-in for the **dormant Lighthouse-CI gate** (Playwright MCP has none of this). Note it in `/design-qa` as a perf tier and the `/scale-up` performance recipe. Complements, does not replace, Playwright MCP.
3. **Draft `/scale-up` recipe: Stirling-PDF** — fills the deliberate PDF-export gap (`lib/export.ts`, "pdfkit fragile in serverless"). Pattern: **self-hosted sidecar**, a Next route POSTs the doc to its REST API behind `withInternalAuth`/shared-secret; keep it network-isolated (PDFs carry Restricted/PII). MIT core, Java (never an in-process dep). Apply Gate #1: log the build-vs-buy decision in the ledger. There is already a seed ledger entry for `lib/pdf/**` from this session.
4. **Draft `/scale-up` recipe: crawl4ai** — scraping-as-data-source (ingest page → Markdown → Prisma). Also a **sidecar** (Apache-2.0, Python + Chromium). ⚠️ **SSRF is the headline risk** — operator-supplied URLs must be allowlisted + network-isolated (OWASP A10); route behind an auth wrapper + `withRateLimit`.
5. Each is a real change: run `/blueprint` where it applies, `/ship`, commit, push to this branch. MCP `.mcp.json` edits are config; the recipes are docs under `.claude/skills/scale-up/` or `docs/recipes.md`.
