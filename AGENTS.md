# AGENTS.md — cross-tool AI-assistant pointer

Orients **any** AI coding assistant (Cursor, Copilot, Windsurf, Aider, …) in this repo.
This file is a pointer only — it deliberately restates **nothing**, so there is exactly one
copy of every rule and no chance of a stale duplicate.

- [`CLAUDE.md`](./CLAUDE.md) — **the contract.** Stack, hard rules (auth wrappers, Prisma-only
  data access, zod at every boundary, no secrets in logs/commits, audit invariants), the five
  pillars, the "Ask before" list, project tiers.
- [`SECURITY.md`](./SECURITY.md) — data classification, authz model, threat model, secrets
  handling, findings register.
- `docs/rules/*.md` — path-scoped detail (Prisma · API routes · UI · deploy · AI · harness).
  Read the file matching what you are editing; its frontmatter `globs:` says which paths it covers.
- [`docs/REPO-MAP.md`](./docs/REPO-MAP.md) — "where is X".

Read `CLAUDE.md` before non-trivial work. Run `npm run ship` before every push; do not push red.
After pushing code, run the post-push breadth review (`.claude/agents/senior-code-reviewer.md`,
ADR-020; CI path `.github/workflows/senior-review.yml`).

When in doubt, stop and ask — see the "Ask before" section of `CLAUDE.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
