# Blueprint — Vendored third-party skill packs (`npx skills add`)

Scope: .agents/skills/**, skills-lock.json, scripts/skill-standard-check.mjs

## Problem & outcome

The operator installed the `Leonxlnx/taste-skill` pack (13 design/frontend skills,
MIT-licensed, ~79k-star upstream) with `npx skills add Leonxlnx/taste-skill`. The
installer vendors upstream markdown verbatim into `.agents/skills/**`, symlinks each
skill into `.claude/skills/`, and pins content hashes in `skills-lock.json`.

That import path deliberately **diverges from the ADR-022 built-not-imported
convention** (`sdlc-chain.md` AC-2.3: adopted skills are rewritten against this repo's
primitives). This blueprint records that divergence as a decision, not an oversight:

- **Vendored, not rewritten — by design.** These skills are installer-managed:
  `npx skills add` re-runs must cleanly update them, and `skills-lock.json`'s
  `computedHash` pins them to upstream. A house-style rewrite would fork the content,
  break hash verification, and turn every upstream update into a manual merge. The
  nine sdlc-chain skills were adopted as _permanent template internals_; this pack is
  an _operator-chosen add-on_ that stays upstream-shaped so it stays updatable.
- **License:** upstream is MIT, Copyright (c) 2026 Leonxlnx
  (github.com/Leonxlnx/taste-skill LICENSE). Attribution retained here; the vendored
  files are unmodified upstream content, so upstream's copyright header governs.
- **Security bar unchanged:** vendored content is reviewed pre-commit for
  prompt-injection/exfiltration/security-floor-override language (clean on install —
  see the install commit and its senior review), and gitleaks scans `.agents/**`
  like any tracked path. `.agents` is Prettier-ignored (upstream-owned formatting)
  but excluded from **no** security gate.

## Stories

- As the operator, I can install a third-party skill pack and have every skill pass
  the same `skill-check` conformance gate as native skills.
- As the operator, I can re-run `npx skills add` to update the pack without merge
  conflicts against local edits.
- As a future session, I can read this blueprint and know why `.agents/skills/**`
  content doesn't mention `/ship`, the five pillars, or blueprint `Scope:` language.

## Scenarios

- **Happy:** `npx skills add <pack>` → skills land in `.agents/skills/**` + symlinks →
  `/ship`'s `skill-check` and `evals` steps see them (symlinks resolved via
  `statSync`, not `Dirent.isDirectory()`) → conformance and routing verified → green.
- **Worst:** a future pack ships a skill whose SKILL.md carries injection-shaped
  directives or breaks frontmatter conformance → content review at install plus
  `skill-check` RED blocks the push; the pack is removed or the skill deleted rather
  than waved through.

## Routing adjudication (2026-08-23 install)

The pack overlaps `/design-system`'s territory by intent (it exists to style UI).
Adjudication: **generic aesthetic prompts** ("make this look right/premium") may route
to the pack; **repo-anchored prompts** (shared primitives, tokens, vetted recipes)
must keep ranking `/design-system` top-3 — `evals/cases/design-system.json` encodes
this split. `/design-system` remains the constitution's default UI rail; taste-skill
packs are invoked explicitly or via generic-aesthetic routing.

## Open questions

- Eval case files for the 13 vendored skills (`evals/cases/<name>.json`) are a
  follow-up — the eval runner treats a missing case as WARN by design. Author them
  if routing quality for the pack starts to matter.
