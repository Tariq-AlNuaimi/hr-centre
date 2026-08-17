# ADR-003 — Release process: `/release` after `/promote`

> **SUPERSEDED by [ADR-006](ADR-006-pivot-to-vercel-neon.md)** — the `/promote` + Portainer + `prod-YYYYMMDD-HHmm` release flow no longer exists; Vercel owns deploys (push to `main` → production, revert the commit to roll back). Historical record only.

**Status:** Superseded by ADR-006
**Date:** 2026-05-18
**Decision owner:** Tariq AlNuaimi
**Reviewers:** —

> **Superseded by ADR-006 (Vercel + Neon pivot).** This ADR describes a release flow built on `/promote`, Portainer prod webhooks, and `prod-YYYYMMDD-HHmm` tags — all of which ADR-006 removed. On the current rail, Vercel owns deploys (push to `main` → production; revert the commit to roll back) and there is no `/promote` or `/release` skill. Kept for historical context only.

## Context

`/promote` ships staging → prod by tagging `prod-YYYYMMDD-HHmm` and triggering the prod Portainer webhook. After it returns, there is no audit trail of "what shipped Tuesday" — the operator has to grep `git log <prev-tag>..<curr-tag>` by hand, and the GitHub releases page stays empty.

Conventional Commits is already used loosely in the repo (`feat:`, `fix:`, `chore:`, etc. show up in `git log --oneline`). Formalizing the release categorization makes it useful without adding new discipline beyond what we already do.

The bar is low — a CHANGELOG entry + a GitHub release per prod deploy. The cost is the chunk of operator attention to run a second command after `/promote`.

## Decision

- **After each `/promote`, operator runs `/release`** to draft a CHANGELOG entry + GitHub release.
- Release notes are generated from `git log <prev-prod-tag>..<curr-prod-tag>`.
- Categorization is driven by Conventional Commits prefixes (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`). Anything else falls into an "Other" bucket.
- `CHANGELOG.md` lives in the repo and is prepended to on every release (newest first).
- GitHub release `tag_name` = `name` = the `prod-*` tag; body = the categorized list.
- **Not automatic on `/promote` — kept composable** so a hotfix can be promoted without a release entry if undesired.

## Consequences

### Positive

- `CHANGELOG.md` grows in the repo, auditable in PR diffs, accessible offline.
- The GitHub releases page becomes the canonical "what's in prod" timeline.
- Each release is tied to its `prod-*` tag, so the rollback target is always one click away (`/rollback --to sha-<prev>`).

### Negative

- ~30 seconds per promotion of operator time.
- A second command to remember (mitigated: `/promote` skill explicitly recommends `/release` as the follow-up).
- Operators who don't use Conventional Commits get a flat "Other" section. Still readable, just less categorized.

### Mitigations

- `/release --auto` picks the newest `prod-*` tag with no flags — minimal friction.
- `/release --dry-run` lets the operator inspect the draft before writing / committing.
- The script is idempotent on the GH side: re-running with the same tag warns and skips instead of erroring.

## Alternatives considered

1. **Fully automatic in `/promote`.** Rejected: composability matters more. A hotfix shouldn't produce a CHANGELOG entry mid-incident, and the operator should always have a beat to confirm what the notes say.
2. **`semantic-release` for auto-versioning from commit messages.** Rejected: adds a heavy dep, forces strict commit discipline (every commit must conform or releases break), and the template is not publishing an npm package — version numbers are not the artifact.
3. **Manual CHANGELOG edits in PRs.** Rejected: drift inevitable. The operator skips it on the third busy week and the changelog dies.
4. **GitHub auto-generated release notes only (no CHANGELOG.md).** Rejected: the in-repo file is grepable from a terminal during an incident; the GH page requires browser auth.

## Migration triggers

- If the team starts cutting release candidates / RC tags before prod, revisit the tag-discovery logic (it currently filters `prod-*` strictly).
- If multiple `/promote` runs land per day, consider grouping by date instead of per-tag (UI-side noise).
- If the template starts shipping as a published package (today it doesn't), revisit semantic-release.
- If a project requires PDPL / regulatory release-note disclosure (data handling changes), formalize the bucket list to include a "Security & compliance" section.

## Related

- `scripts/release.mjs` — implementation
- `.claude/skills/release/SKILL.md` — skill walkthrough
- `.claude/skills/promote/SKILL.md` — upstream trigger (mentions `/release` as follow-up)
- `CLAUDE.md` — registers `/release` alongside other skills
