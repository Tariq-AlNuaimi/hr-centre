# Token policy — operating Claude Code without burning the budget

Research-backed (ADR-019; sources: code.claude.com/docs/en/costs, /best-practices,
/context-window, /large-codebases; community-measured repos; enterprise rollouts).
The repo side is already enforced by this template; the session habits are the
operator's half of the contract.

## Repo side (enforced by this template)

1. **CLAUDE.md ≤ ~200 lines.** It is loaded every session and re-sent after every
   compaction; every line is a permanent tax AND dilutes instruction-following
   ("bloated CLAUDE.md files cause Claude to ignore your actual instructions" —
   Anthropic). Details live behind pointers: `docs/recipes.md`, skill SKILL.mds,
   ADRs. When adding to CLAUDE.md ask: "would removing this cause mistakes?" If
   not, it goes in a doc/skill instead.
2. **Quiet gates.** `npm run ship` prints ~12 lines, not thousands — verbose
   test/build output is the #1 in-session token sink (Anthropic's own example:
   10k-line log → hundreds of tokens). Never run the full suite raw when the
   gate script exists; never tail a dev server in foreground.
   - **Reserve `--full` for the moments that need it.** `npm run ship -- --full`
     adds the ADR-030 docker image-build + trivy scan phase (wall-time + a longer,
     noisier log than the fast loop). It belongs at `/deploy`, `/handoff`, and CI —
     not on every push. The default `npm run ship` stays image-free so the tight
     iteration loop (and its token cost) is unchanged; a WARN-degrade when Docker
     is unavailable keeps the full loop from failing on daemon-less machines.
3. **Read-deny on bulk artifacts.** `.claude/settings.json` denies Read on
   `.next/`, `node_modules/`, `generated/` so a stray search can't pull a 600KB
   minified chunk or the generated Prisma client into context.
4. **Skills = progressive disclosure.** Workflow knowledge lives in
   `.claude/skills/*/SKILL.md`, loaded only when invoked — never inline in
   CLAUDE.md.

## Session habits (the operator's half — biggest levers first)

1. **One task per session; `/clear` between tasks.** After 2 failed corrections,
   `/clear` and re-prompt with what you learned — "a clean session with a better
   prompt almost always outperforms a long session with accumulated corrections."
2. **Prune MCP servers** (`/mcp`, check `/context`). Community-measured: up to
   ~67k tokens of tool schemas before your first prompt; one search server alone
   was 14k. Prefer CLIs (`gh`, `vercel`) over MCP equivalents.
3. **Model tiering.** Sonnet by default; Opus/Fable only for architecture-grade
   work; `model: haiku` for simple subagents. Thinking tokens bill as output —
   lower `/effort` or set `MAX_THINKING_TOKENS` for routine sessions.
4. **Subagents for exploration.** "Investigate X with a subagent" keeps hundreds
   of file-reads out of the main window; only the summary returns. Avoid the
   named failure mode: unscoped "explore the codebase".
5. **Specific prompts.** "Add zod validation to POST /api/users in
   app/api/users/route.ts" — not "improve validation". Vague prompts buy
   repo-wide scanning.
6. **`/compact <instructions>` proactively** at natural milestones (after a green
   ship), not when forced at the limit; `/btw` for side questions (never enters
   history); save plans/specs to files — files survive compaction, history may not.
7. **Don't break the prompt cache.** Cache reads are 0.1x price; changing
   settings/MCP set/system content mid-session invalidates the cached prefix.
   Keep CLAUDE.md stable within a working day.
8. **Watch the meter.** `/usage` (per-session + 7d attribution), `/usage-credits`,
   `/context` (live breakdown); `ccusage` (16k-star community tool) for local
   session reports. Anthropic baseline: ~$13/dev/active-day average, 90% < $30.
9. **Plan mode economics.** Use it for multi-file work (prevents expensive
   re-work); skip it when you could describe the diff in one sentence — plan
   mode itself costs overhead.
10. **Headless for batch.** Repetitive migrations: `claude -p` per file with
    `--allowedTools` and `--max-turns` — fresh minimal context each run beats
    one giant session (Airbnb's 3.5k-file migration pattern: cheap capped
    retries, validation gates in the loop).

## Model-routing tiers (ADR-022)

Route work to the cheapest model that can do it well. This is the formalized
version of habit #3 above — guidance, not an auto-router (a metric with no real
token accounting behind it is theater; see ADR-022). Enforcement points are
subagent `model:` frontmatter and your per-session `/model` choice.

| Tier | Model | Route here | Mechanism / where |
|---|---|---|---|
| **Cheap** | `haiku` | repo-wide search, "where is X / how does Y work", orientation passes, reading >5 files, repetitive codemods, scaffold lookups | `scout` agent (`model: haiku`); `/batch` headless per-file runs |
| **Mid** | `sonnet` | functional single-/few-file edits, post-push review breadth, moderate multi-file work | default working model; `senior-code-reviewer` (`model: sonnet`) |
| **Top** | `opus` / `fable` | architecture & design, ambiguous/high-blast-radius work, anything on the Ask-before surface (auth, `lib/`, schema, migrations, `middleware.ts`), spec/plan authorship | `/model opus` (or fable) for that session only |

Rules of thumb: **delegate down before working up** — push exploration to `scout`
and batch jobs to `/batch` so the top-tier session spends its context on judgment,
not file-reads. Don't pin a project-wide default model (ADR-019): your account /
`/model` choice stands; only subagents tier down in their definitions. When a
session is purely mechanical, drop yourself to `/model sonnet` and let `scout`
carry the haiku-tier reads.

## Automation shipped (ADR-019) — what the harness now does for you
| Concern | Mechanism |
|---|---|
| Know the burn live | statusline: `model \| ctx % \| msgs \| $` (.claude/statusline.mjs) |
| Detect when to start fresh | UserPromptSubmit watchdog warns at 60% / 80% context |
| Hand off cheaply | `/handoff-session` commits `docs/SESSION-HANDOFF.md` to the branch (survives a fresh remote container) AND prints the full handoff to paste — both carriers, works on web + laptop |
| Stop token-bomb commands | PreToolUse guard denies raw `npm test`/build/dev-server with the quiet alternative (override: prefix `VERBOSE=1`) |
| Cheap exploration | `scout` agent (haiku, read-only, ≤30-line reports) |
| Durable cross-session memory | `docs/agent-memory.md` surfaced at SessionStart (bounded), written via `/remember` + `/handoff-session` promotion (ADR-022) |
| Model routing | tier table above (haiku/sonnet/opus) — guidance + subagent frontmatter, no auto-router (ADR-022) |
| O(1) orientation | docs/REPO-MAP.md, auto-refreshed by SessionStart when stale |
| Batch jobs | `/batch` — headless per-file runs, capped turns/retries, cost logged |
| Per-session accounting | SessionEnd receipt → .claude/usage-log.jsonl |
| Model choice | NO forced project default — your account/`/model` choice stands. Subagents still tier down (scout = haiku). Drop to `/model sonnet` yourself for mechanical sessions. |
| MCP overload | SessionStart warns when >3 servers configured |

## Operator-only (one-time / per-session, cannot be automated from the repo)
| Action | How |
|---|---|
| Prune MCP servers | `/mcp` → disable unused (check `/context` first) |
| Monthly hard cap | `/usage-credits` → set limit |
| Architecture-day model | `/model opus` (or fable) for that session only |
| Side questions | `/btw` (never enters history) |
| Thinking budget (opt-in) | `MAX_THINKING_TOKENS=8000` env for mechanical sessions — NOT global |
| Code-intelligence plugin | install an LSP plugin once: go-to-def replaces grep+reads |
| Weekly review | `/usage` + `.claude/usage-log.jsonl` (or `npx ccusage`) |
