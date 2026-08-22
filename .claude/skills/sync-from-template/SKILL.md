---
name: sync-from-template
description: Pull later template enhancements into a fork that was generated from this template (GitHub "Use this template" -> no shared git history). Path-scoped, additive checkout of template-owned layers only; mixed files (lib/, CLAUDE.md, Ask-before files) get a review diff, never an auto-overwrite. Records a version marker so a fork can tell when it is behind. Use when the user says "pull template updates", "sync from template", "update from upstream", "get the latest template changes", "/sync-from-template", or asks how to make existing projects follow new template enhancements.
---

# /sync-from-template — propagate template enhancements into an existing fork

Forks are created with GitHub **"Use this template"** (`scripts/new-project.mjs`
hits the `/generate` API), which produces an **unrelated git history**. So there
is no `git merge upstream`. This skill instead does a **path-scoped, additive**
checkout of the template's infrastructure layers and leaves everything staged for
review — the fork's own data/features are never touched.

Backed by `scripts/sync-from-template.mjs`.

## What it does

- Adds a `template` git remote (default
  `https://github.com/Tariq-AlNuaimi/fullstack-vibe-template.git`; override with
  `--template <url>`), fetches `main`.
- **OWNED layers** (pulled, then unstaged for review): `.claude/skills`,
  `.claude/agents`, `.claude/hooks`, `.claude/statusline.mjs`, `eslint-rules`,
  `scripts`, `docs/decisions`, `docs/ARCHITECTURE.md`, `docs/recipes.md`,
  `docs/uat-rubric.md`, `.gitleaks.toml`, `eslint.config.mjs`. Path-scoped
  checkout is additive — fork-only files at these paths are preserved.
- **REVIEW layers** (diff only, NEVER auto-applied): `lib`, `CLAUDE.md`,
  `AGENTS.md`, `.claude/settings.json`, `middleware.ts`, `vercel.json`,
  `next.config.ts`, `package.json`, `tsconfig.json`, `playwright.config.ts`,
  `tests/contracts`. These mix template improvements with per-fork edits and
  include the **Ask-before files** (the security-critical ones: auth,
  rate-limit, email, export, anything under `lib/prisma/`, `middleware.ts`), so a
  human reconciles them **by hand** — they are never auto-applied. The diff is
  written to `.template-sync-review.diff` (gitignored).
- **Fork-owned** (never touched): `prisma/`, `app/`, `components/`, `messages/`,
  `i18n/`, `project.config.json`, package identity, `.env*`, `public/`.

> **Hook wiring trap (why a hook can be "template-only").** `.claude/hooks` is
> OWNED (auto-pulled) but `.claude/settings.json` — which _wires_ each hook to its
> event (`SessionStart`/`UserPromptSubmit`/`Stop`/`PreCompact`) — is a REVIEW layer.
> So a fork that pulls a NEW or changed hook script but skips the `settings.json`
> diff ends up with the script on disk and **no event binding → the hook never
> fires**. This is the usual cause of "the hook works in the template
> but not in my fork." After any sync that touches `.claude/hooks`, **always
> reconcile the `settings.json` `hooks` block** from `.template-sync-review.diff`
> and confirm every shipped hook is bound. (A self-check: the hook scripts present
> under `.claude/hooks/` should each have a matching command in `settings.json`.)

- Writes **`.template-sync.json`** (committed) recording the template commit the
  fork is now based on — the version marker.

## Run

```sh
# See how far behind, and exactly which files differ — touches nothing:
npm run sync-template -- --check

# Preview what a sync would pull:
npm run sync-template -- --dry-run

# Do it (requires a clean working tree; stages OWNED layers for review):
npm run sync-template
```

Flags: `--template <url>` (source; remembered in the marker after first run),
`--ref <branch>` (default `main`), `--remote <name>` (default `template`).

`--check` exits **3** when the fork is behind (0 when up to date) so it can gate a
hook or CI step later.

## After running

1. `git diff` — review the auto-pulled OWNED changes.
2. Merge the mixed files by hand from `.template-sync-review.diff`. Treat the
   Ask-before files (`lib/api-helpers.ts`, `lib/rate-limit.ts`, `lib/email.ts`,
   `lib/export.ts`, anything under `lib/prisma/`, `middleware.ts`) as
   stop-and-think: only port the template's _improvement_, keep the fork's logic.
3. If anything under auth / `lib` / schemas / API routes changed, run
   `/code-review`. **If the REVIEW diff is large or conflicting** (many
   `lib/` / `CLAUDE.md` / Ask-before hunks, or hunks that clash with the fork's
   own edits), run `/code-review` **before committing** so a security-critical
   change isn't silently dropped while reconciling.
4. `npm run ship` until green, then commit (include `.template-sync.json`). Name
   the commit with the template commit hash from `.template-sync.json`, e.g.
   `chore: sync from template @ <short-hash>` — so the fork's history records
   exactly which template version it pulled.

## Notes & limits

- **Clean tree required** for an apply — the script refuses on a dirty tree so the
  sync lands as its own reviewable commit. `--check` / `--dry-run` always run.
- **Additive, not a mirror.** A file the template _deleted_ is not removed from
  the fork; this skill brings in updates/additions, it does not prune. Intentional
  — pruning would risk deleting fork features.
- **Private template:** `git fetch` uses your existing git credentials; ensure
  they can read the template repo.
- **Self-updating:** because `scripts/` and `.claude/skills/` are OWNED, running a
  sync also updates this skill and script to the template's latest.
- **Hook + `lib/` coordination:** `.claude/hooks` is OWNED (auto-pulled) but `lib/`
  is REVIEW (hand-merged). When a sync changes **both** in the same run, a new hook
  can land while the `lib/` change it depends on is still sitting unreconciled in
  `.template-sync-review.diff` — a hook calling into a not-yet-merged helper. Land
  the `lib/` half first, or stage them together, and `npm run ship` before
  committing so the mismatch surfaces.
- This skill ships in the template, so every _future_ fork inherits it. To seed it
  into an _existing_ fork, copy `scripts/sync-from-template.mjs` +
  `.claude/skills/sync-from-template/` over once, or run the manual recipe in the
  "What it does" list, then use the skill from then on.

## When NOT to use

- Brand-new project from scratch — use `/new-project` or `/first-fork`.
- Foreign code built outside the template — use `/conform` (uplifts external code
  to the standard and pushes to a new repo).
- Porting **data** from another database — use `/migrate-from`.

## Verification

Before calling this done:

- [ ] `npm run sync-template -- --check` was run first so the sync is against a known "how far behind" baseline
- [ ] The OWNED layers pulled cleanly and were reviewed (`git diff`), and the REVIEW layers were hand-merged from `.template-sync-review.diff` rather than auto-applied
- [ ] Any Ask-before file touched (`lib/api-helpers.ts`, `lib/rate-limit.ts`, `lib/email.ts`, `lib/export.ts`, `lib/prisma/*`, `middleware.ts`) was reconciled by hand and, if changed, ran through `/code-review`
- [ ] `.claude/hooks` and `.claude/settings.json`'s `hooks` block were reconciled together (a new/changed hook script has a matching event binding)
- [ ] `npm run ship` is green and the commit includes the updated `.template-sync.json`, named with the template commit hash it recorded

**Emits:** updated template-owned layers (the OWNED paths) plus a recorded version marker (`.template-sync.json`, committed) naming the template commit the fork is now based on.
