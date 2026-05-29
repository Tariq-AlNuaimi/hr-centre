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

## Phase completion log

- Phase 0 — baseline green, hash recorded. ✅
- Phase 1 — SECURITY.md reconciled (cut/kept/rewrote confirmed by operator). ✅
- Phase 2 — gitleaks + npm audit re-homed into /ship; CI marked dormant. ✅
- Phase 3 — audit-purge documented dormant; retention flagged at handoff. ✅
- Phase 8.4 — /audit skill added (built before /conform). ✅
- Phase 7 — /conform skill added (report-and-approve). ✅
- Phase 8 — personal/shared tier switch (project.config.json + docs + handoff guard). ✅
- Phase 5 — native /code-review adopted (CLAUDE.md rule + /ship cross-ref). ✅
- Phase 4 — doc-wiring only (4.2 market-benchmark + 4.4 boundary). ✅
- Phase 6 — ADR-007 written; /new-project shelved; UAT-via-Chrome noted as future. ✅

## Pending operator actions (cannot be done from this session)

- **Phase 4.1** — install Superpowers via the interactive `/plugin` command:
  `/plugin marketplace add obra/superpowers-marketplace` then
  `/plugin install superpowers@superpowers-marketplace` (or `superpowers@claude-plugins-official`).
- **Phase 4.3** — run one throwaway end-to-end Superpowers cycle (brainstorm → spec → plan →
  build) to see its TDD/planning style before trusting it on a real project.
- **gitleaks / semgrep not installed in this container** — install locally so `/ship` and
  `/audit` can run their secret + SAST scans (they report loudly when missing, never skip silently).

### Local-env note (not a defect, not in scope to change)
`.env` (copied from `.env.example` by the SessionStart hook) sets `NODE_ENV="development"`.
Prisma 7 config does not auto-load `.env`, so DB-touching commands need the env loaded:
`set -a; . ./.env; set +a`. When running `npm run build` locally, also `export NODE_ENV=production`
or prerendering fails on `/_not-found` / `/_global-error`. On Vercel this does not occur because
`.env` is gitignored and the platform sets `NODE_ENV=production`.
