# ADR-019 — Token-thrift harness: automate context discipline

**Status:** Accepted
**Date:** 2026-06-12
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-007 (solo rail), `docs/token-policy.md` (the operating policy)

## Context

The operator uses Claude Code daily; token spend was throttling work (the org
spend limit was hit mid-session during the research for this ADR). Research
across three source pools — Anthropic's official cost/best-practice docs,
measured community repos, and enterprise rollout playbooks — converges on a
short list of levers: startup-context size, long-session resend, unscoped
exploration, verbose tool output, model tiering, and metering. Most are
habits; habits decay. The decision is to make the harness detect and enforce
them instead.

## Decision

Ship token discipline as code in `.claude/` (full mapping: `docs/token-policy.md`):

1. **CLAUDE.md ≤ ~200 lines** (done: 382 → ~80): binding rules inline, everything
   else behind pointers (`docs/recipes.md`, SKILL.mds, `docs/REPO-MAP.md`).
2. **Context watchdog** (UserPromptSubmit hook): warns once at 60% and 80% of the
   window; pairs with the **`/handoff-session`** skill that freezes state into
   HANDOFF.md + a paste-ready prompt for a fresh session.
3. **Verbose-command guard** (PreToolUse hook): denies raw `npm test` / builds /
   foreground dev servers with the quiet alternative in the denial reason;
   `VERBOSE=1` prefix overrides deliberately.
4. **scout agent** (haiku, Read/Grep/Glob only, ≤30-line reports): all repo-wide
   investigation runs there, not in the main window. CLAUDE.md binds this.
5. **Repo map**: `scripts/repo-map.mjs` → `docs/REPO-MAP.md` (~1k tokens:
   routes+methods, models+fields, lib exports, components), auto-refreshed by
   the SessionStart hook when schema/app/lib are newer.
6. **Model tiering by task, not a forced default.** Deliberately NO project-level
   `model` in settings.json: it would only bite sessions where the operator
   didn't choose (and the operator's `/model` always overrides it anyway), while
   risking an under-powered architecture/review session — the dimension where
   capability matters most. Subagents still tier down where it's pure win
   (scout = haiku, retrieval only). The operator drops to `/model sonnet` for
   mechanical sessions by choice; `docs/token-policy.md` documents this.
7. **Metering**: statusline (model | ctx% | msgs | $), SessionEnd receipt to
   `.claude/usage-log.jsonl` (gitignored), SessionStart warning when >3 MCP
   servers are configured.
8. **`/batch` skill**: repetitive N-file jobs run as capped headless `claude -p`
   loops (max-turns, ≤2 attempts/file, cost logged) — never one long session.

Operator-only actions (cannot be repo-automated) are tabled in
`docs/token-policy.md`: `/mcp` pruning, `/usage-credits` cap, `/btw`,
opt-in `MAX_THINKING_TOKENS`, LSP plugin install, weekly `/usage` review.

## Consequences

### Positive

- The two dominant cost drivers (long-session resend, unscoped exploration)
  now have automated detection (watchdog) and a cheap alternative (scout,
  handoff) at the moment they occur.
- Every fork inherits the discipline; nothing relies on the operator's memory.

### Negative

- Hooks add ~100ms per event and can misfire; the guard may deny a command the
  operator genuinely wanted raw (mitigated: `VERBOSE=1` escape hatch, and all
  hooks fail open on any parse error).
- No forced model default means a "didn't think about it" session uses whatever
  the operator's account default is — could be more expensive than necessary for
  a mechanical task (mitigated: statusline shows the model; operator tiers down
  by choice). This was a deliberate reversal — capping the operator's own model
  fights the goal of high-quality output for a power user; the savings come from
  context hygiene, not from a capability cap.

### Mitigations

- All hooks are fail-open (`catch → exit 0`); the harness can never block work.
- `docs/REPO-MAP.md` is generated; staleness is bounded by the SessionStart check.

## Alternatives considered

1. **Policy doc only, no automation** — that was the state after the research
   landed; rejected because habit-based savings decay (the research's own
   finding: enforcement beats alerts).
2. **External gateway (LiteLLM) with hard budget rejection** — enterprise-grade
   enforcement, but infra overhead is unjustified for a solo operator;
   `/usage-credits` provides the account-level cap.

## Migration triggers

- Claude Code shipping native equivalents (e.g. built-in context warnings or
  cost statusline) supersedes the corresponding custom hook — delete ours then.
- A second regular contributor: revisit per-user metering (ccusage/OTel).

## Related

- `docs/token-policy.md` · `.claude/hooks/{context-watchdog,verbose-guard,session-receipt}.mjs`
- `.claude/statusline.mjs` · `.claude/agents/scout.md`
- `.claude/skills/handoff-session/` · `.claude/skills/batch/` · `scripts/repo-map.mjs`
