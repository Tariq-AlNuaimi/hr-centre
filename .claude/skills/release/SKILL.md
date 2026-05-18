---
name: release
description: Draft a CHANGELOG entry + GitHub release from the commits between the previous prod-* tag and the current one. Executes via the `release.yml` GitHub Actions workflow (ADR-004), and is auto-triggered by the `prod-*` tag push from `/promote`. Use when the user says "release", "draft release notes", "changelog", "/release", "after promote".
---

# /release — CI-driven release notes + GH release

`release.yml` has two triggers:

1. **Push of a `prod-*` tag** — `/promote` always tags `prod-YYYYMMDD-HHmm`,
   which auto-fires this workflow. **Most operators never need to invoke
   `/release` manually.**
2. **`workflow_dispatch`** — for re-drafting an old tag, or if the
   auto-trigger was skipped (e.g. hotfix path).

See ADR-003 (composable, not auto-inside-/promote) + ADR-004 (CI-driven ops).

## When to invoke manually

- Re-draft notes for a previous `prod-*` tag.
- The push-trigger was skipped (workflow disabled, GH outage during the
  promote run).
- Inspecting categorization in dry-run (run script locally).

## Manual trigger command Claude composes

```sh
gh workflow run release.yml \
  -f tag=prod-20260518-1530         # explicit
# or omit tag with auto=true (default) to use newest:
gh workflow run release.yml
```

## What the workflow does

1. `actions/checkout@v5` with full history (tags needed).
2. `npm ci`.
3. Runs `scripts/release.mjs`:
   - On push: `--tag <pushed tag>`.
   - On dispatch with `tag`: `--tag <provided>`.
   - On dispatch without tag: `--auto` (newest prod-*).
4. Script:
   - Lists prod tags, finds previous, diffs commit log.
   - Categorizes by Conventional Commits prefix.
   - Prepends a section to `CHANGELOG.md`.
   - Commits + pushes (`chore(release): <tag>`).
   - Creates the GitHub release via the REST API using `${{ secrets.GITHUB_TOKEN }}`.

## Refusal cases

- No `prod-*` tags in the repo → bails. Run `/promote` first.
- Tag not found locally → bails (the push trigger always supplies a real
  tag; only relevant on manual dispatch).
- GH release already exists for the tag → warns and continues (idempotent).

## Report back

- The tag released.
- Commits per bucket (Features / Fixes / etc.).
- The GitHub release URL from the workflow output.

## Read before
- `.github/workflows/release.yml`
- `scripts/release.mjs`
- ADR-003 (composable release process)
- ADR-004 (CI-driven ops)
