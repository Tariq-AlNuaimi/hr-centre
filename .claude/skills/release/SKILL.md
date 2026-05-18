---
name: release
description: Draft a CHANGELOG entry + GitHub release from the commits between the previous prod-* tag and the current one. Use after /promote, when the user says "release", "draft release notes", "changelog", "/release", "after promote". Composable -- never runs automatically inside /promote.
---

# /release — Draft CHANGELOG + GitHub release after /promote

Reads the commits between the previous `prod-*` tag and the one `/promote` just created, categorizes them by Conventional Commits prefix, prepends a section to `CHANGELOG.md`, and creates a corresponding GitHub release. See ADR-003.

## When to use

- Right after `/promote` succeeds — every prod deploy gets a release entry by default.
- Standalone, if you need to re-draft notes for an old tag (`--tag prod-...`).
- Skip it on a hotfix where the audit trail would muddy the timeline — that's why it isn't wired into `/promote` (ADR-003).

## Inputs

| Flag | Default | Notes |
|---|---|---|
| `--tag` | — | Explicit `prod-YYYYMMDD-HHmm` tag. If omitted, use `--auto`. |
| `--auto` | false | Use the newest `prod-*` tag in the repo. |
| `--dry-run` | false | Print the entry; don't write / commit / push / call GH. |
| `--no-commit` | false | Skip the `git commit` (the file is still updated). |
| `--no-push` | false | Skip the `git push` after the commit. |
| `--gh-token` | `$GITHUB_TOKEN` | PAT with `repo` scope. |

## Steps

1. `git fetch --tags` (the operator runs this — not the script).
2. Walk: show diff preview of the categorized commits.
3. Ask: "create CHANGELOG entry + GH release for `<tag>`?"
4. Run: `npm run release -- --tag <tag>` (or `--auto`).
5. Push the new commit.
6. Report the GH release URL back to the operator.

## Conventional Commits buckets

| Prefix | Section in CHANGELOG |
|---|---|
| `feat:` | Features |
| `fix:` | Fixes |
| `perf:` | Performance |
| `refactor:` | Refactors |
| `docs:` | Docs |
| `test:` | Tests |
| `build:` | Build |
| `ci:` | CI |
| `chore:` | Chores |
| `style:` | Style |
| `revert:` | Reverts |
| anything else | Other |

Scopes (`feat(api): ...`) are preserved in the message text but don't change the bucket.

## Refusal cases

- No `prod-*` tags in the repo → bails with a hint to run `/promote` first.
- `--tag <X>` not found locally → bails (operator runs `git fetch --tags`).
- `GITHUB_TOKEN` unset and not `--dry-run` → bails.
- GH release for the same tag already exists → warns and continues (idempotent).

## Usage

```
# Right after /promote tagged prod-20260518-1530:
git fetch --tags
npm run release -- --tag prod-20260518-1530

# Or just take the latest:
npm run release -- --auto

# Inspect before writing:
npm run release -- --auto --dry-run
```

## Report back

- The tag that was released.
- Number of commits per bucket.
- The new CHANGELOG.md line count delta.
- The GitHub release URL.

## Read before deeper changes
- `scripts/release.mjs` — the implementation
- `docs/decisions/ADR-003-release-process.md` — why this is composable not automatic
- `.claude/skills/promote/SKILL.md` — the upstream trigger
