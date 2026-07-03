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

How it's used today: **advisory, hook-injected.** `.claude/hooks/skill-activation.mjs`
(wired in `settings.json`, operator-confirmed 2026-07-03) consumes this map on
two events and injects any match as advisory `additionalContext`:

- **UserPromptSubmit** — the prompt text is matched against each rule's
  `keywords` (intent).
- **PreToolUse** on `Edit|Write|MultiEdit` — the touched file is matched against
  each rule's `paths` globs.

It is data, not enforcement:

- The hook only emits a suggestion (`additionalContext`); it **never blocks** and
  never returns a `permissionDecision`, so it cannot override CLAUDE.md, the
  Ask-before list, or a skill's own "Skip when" carve-outs.
- It fires on **every** matching prompt/edit (no session dedupe) and suggests
  **all** matched skills, deduped within a single fire.
- Change behaviour by editing this map — no code change needed. On any internal
  error the hook stays silent (a suggester must never brick a turn).
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
