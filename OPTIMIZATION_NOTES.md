# OPTIMIZATION_NOTES.md

Scratch notes for the `optimize/solo-rail` work (executed on branch `claude/busy-carson-WEvBS`
per the session harness; the plan's intent — a branch off `main`, `main` untouched — is preserved).

## Baseline (Phase 0)

- **Baseline commit hash:** `b024418d40e4a51df4d1ce6e9a32a22b8dd1eea5`
- **Date:** 2026-05-29
- **`/ship` + tests baseline result:** GREEN
  - Typecheck (`tsc --noEmit`): pass
  - Lint (`npm run lint`): pass
  - Tests (`npm test`): 39/39 pass
  - Build (`npm run build`): pass (with `NODE_ENV=production`)

### Local-env note (not a defect, not in scope to change)
`.env` (copied from `.env.example` by the SessionStart hook) sets `NODE_ENV="development"`.
Prisma 7 config does not auto-load `.env`, so DB-touching commands need the env loaded:
`set -a; . ./.env; set +a`. When running `npm run build` locally, also `export NODE_ENV=production`
or prerendering fails on `/_not-found` / `/_global-error`. On Vercel this does not occur because
`.env` is gitignored and the platform sets `NODE_ENV=production`.
