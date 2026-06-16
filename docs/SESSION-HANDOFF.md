# Session handoff

**Goal** — Operator: "make the template robust so whatever is built on it is also robust."
Scope chosen: **enforce-the-floor** — turn documented-but-unenforced invariants into
gates every fork inherits (NOT bulk-applying the §16 security layers, which are
deliberate ADR-014/010/001 deferrals with recipes). Sub-goal: keep iterating on
guardrails.

**State** — Branch `claude/handoff-status-review-yj5tk8`, in sync with origin (pushed).
`git status --short`: clean except this handoff. Last `/ship`: **GREEN** (typecheck +
lint + contract + component + build + gitleaks + npm audit, ~49s). Not deployed (personal tier).

**Done** (this session)
- `3890ebe` (pre-session baseline)
- bulk-write guard: `no-unaudited-bulk-write` ESLint rule + scrub-completeness test (+senior fixes for $transaction/alias) — landed across the first two commits
- `4ec5eaa` feat(eslint): `no-raw-sql-unsafe` — ban `$queryRawUnsafe`/`$executeRawUnsafe` (A03)
- `b548b41` fix: catch tagged-template `*Unsafe` form + sweep stale "four"→"seven" rule counts

**In flight** — none. All senior-review findings on both rules resolved. Review loop closed.

**Decisions**
- Enforce-the-floor only; do NOT apply MFA/atomic-audit/nonce-CSP/lockout/encryption (deferred per ADRs).
- Blanket-ban `*Unsafe` raw SQL (can't detect "user input" statically); escape hatch = justified single-line disable + SECURITY.md §12 log.
- `.call()`/`.apply()`/destructured-name bypasses documented as accepted limitations, not engineered around (both prisma rules).
- ADR-007's "four rules" left as immutable point-in-time record; operator-facing skills swept to "seven".

**Landmines**
- **Fresh container carries env drift**: must `npm install` + `DATABASE_URL=postgresql://u:p@localhost:5432/db npm run prisma:generate` before `/ship`, else typecheck fails on `passwordChangedAt` / `@tanstack/react-query` (commit #36 leftovers, NOT our changes).
- **gitleaks not preinstalled**: download v8.21.2 linux_x64 to `/tmp`, add to PATH, or `/ship` reports RED on a missing tool.
- Template now has **seven** `rihal-template/*` rules at `error` — keep the count consistent if adding more (CLAUDE.md ×2, SECURITY.md ×2, handoff/ship/conform/first-fork skills, rules.test.mjs header).

**Next steps**
1. Pick the next enforce-the-floor guardrail: `withRateLimit` must compose OUTSIDE the auth wrapper (ordering invariant; currently only documented in CLAUDE.md hard rules).
2. Then consider: Excel-export column-allowlist gate (Restricted leakage via `lib/export.ts`); `prismaUnfiltered` misuse / row-level-scoping guard.
3. Each: rule + RuleTester cases + register at `error` + docs/count refresh; `/ship` green; senior-code-reviewer; commit + push.
4. No PR yet — operator hasn't asked. Offer once the guardrail batch feels complete.
