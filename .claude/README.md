# `.claude/` — the harness

The Claude Code harness for this template: skills (`skills/*/SKILL.md`, each
self-documenting), agents (`agents/*.md` — `scout` for cheap read-only
investigation, `senior-code-reviewer` for the post-push breadth pass), hooks
(`hooks/` — SessionStart bootstrap, context watchdog, the Stop-hook push guard),
and `settings.json` (permissions + hook bindings; an Ask-before surface — see
CLAUDE.md). CLAUDE.md is the authority on how these compose; this README only
covers what lives here.

## `skill-rules.json` — advisory skill auto-activation

Maps operator intent (keywords) and touched paths (globs) to the skill that
should handle the work (pattern borrowed from ChrisWiles/claude-code-showcase;
see `docs/deep-comparison/01-collections.md`). Our skills are otherwise
invoke-only — this file closes the "agent improvises instead of using the
skill" gap.

How it's used today: **advisory, agent-consulted.** At the start of a task,
match the request/changed files against the rules and *suggest* (or invoke) the
mapped skill. It is data, not enforcement:

- It never overrides CLAUDE.md, the Ask-before list, or a skill's own
  "Skip when" carve-outs.
- No hook consumes it yet. Wiring a `UserPromptSubmit` hook to inject matches
  automatically is the natural next step, but that is a `settings.json` change
  (Ask-before) — propose it, don't slip it in.
- Keep rules honest: a rule earns its row by naming a real temptation to
  improvise. Don't mirror the whole skill list here.

## Plugin evaluation (note)

We compose external plugins (Superpowers for multi-file methodology; the native
`/code-review`) rather than building portable ones. Before adopting any new
plugin/skill pack into the harness, run a lightweight eval — does it beat the
in-repo equivalent on our stack, what does it add to the token budget, does it
respect the security floor — and record the verdict as an ADR (the
`plugin-eval` idea from wshobson/agents, `docs/deep-comparison/06-frameworks.md`).
Candidates live in `docs/deep-comparison/ADOPT.md`; nothing installs without a
signed row there or an ADR.
