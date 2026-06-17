# Session handoff

**Goal** — Operator: "make the template robust so whatever is built on it is also robust."
Scope chosen: **enforce-the-floor** — turn documented-but-unenforced invariants into
gates every fork inherits (NOT bulk-applying the §16 security layers, which are
deliberate ADR-014/010/001 deferrals with recipes). Sub-goal: keep iterating on
guardrails.

**State** — Branch `claude/enforce-floor-guardrails-slq4u1`, in sync with origin (pushed,
HEAD `e369cf6`). **PR #37 OPEN** → `main` (https://github.com/Tariq-AlNuaimi/fullstack-vibe-template/pull/37).
`git status --short`: clean except this handoff. Last `/ship`: **GREEN** (typecheck +
lint + contract + component + build + gitleaks + npm audit, ~46s). Not deployed (personal tier).
Local plugin is now **ten** `rihal-template/*` rules at `error`.

**Done** (this session — 3 guardrails, the import-allowlist half of the prior batch's "next steps")
- `33f7378` + `57a635e` — `no-rate-limit-inside-auth`: `withRateLimit` must compose OUTSIDE the auth wrapper (A04). Flags a `withRateLimit(...)` in an auth wrapper's handler-arg slot (arg 0 for withAuth/withAdminAuth/withEditorAuth, arg 1 for withInternalAuth/withApiAuth). +senior fixes.
- `2cbba13` — `no-restricted-export-column`: secret-named field as a `toExcel` column key leaks raw value into the `.xlsx` (SCRUB_FIELDS doesn't cover exports; SECURITY.md §1). + `tests/contracts/export-column-completeness.test.ts` keeps the denylist ⊇ SCRUB_FIELDS.
- `77bae65` — fix stale README rule-count (was "four"); add README to the count-sync checklist.
- `ef284a0` + `e369cf6` — `no-prisma-unfiltered-import`: raw client allowlisted to auth/recycling-bin/audit-log/internal/health/prisma-lib + the dashboard-home RSC. +senior fixes (tightened dashboard fragment, boundary tests, limitation docs).

**In flight** — none. All three rules senior-reviewed; every finding resolved. PR #37 open and
green; **NOT yet watched** — offer the operator `subscribe_pr_activity` to autofix CI / review.

**Decisions**
- Enforce-the-floor only; do NOT apply MFA/atomic-audit/nonce-CSP/lockout/encryption (deferred per ADRs).
- `prismaUnfiltered` guard = **import-allowlist** (operator-confirmed). True row-level scoping is NOT statically lintable — explicitly out of scope.
- Adding a file to the prismaUnfiltered allowlist is an Ask-before change (deliberate, reviewed).
- All lint rules: namespace-import / dynamic-`import()` / `require()` / destructured / `.call`-`.apply` bypasses documented as accepted limitations, not engineered around (consistent across the plugin).
- Branch note: this branch was fast-forwarded onto the prior session's `claude/handoff-status-review-yj5tk8` to keep the batch one continuous chain; push target stays `claude/enforce-floor-guardrails-slq4u1`.

**Landmines**
- **Fresh container carries env drift**: must `npm install` + `DATABASE_URL=postgresql://u:p@localhost:5432/db npm run prisma:generate` before `/ship`, else typecheck fails on `passwordChangedAt` / `@tanstack/react-query` (commit #36 leftovers, NOT our changes).
- **gitleaks not preinstalled**: download v8.21.2 linux_x64 to `/tmp`, add to PATH, or `/ship` reports RED on a missing tool.
- **`eslint --cache` (used by `npm run ship`) does NOT invalidate on rule-SOURCE changes** — after editing anything under `eslint-rules/`, clear `node_modules/.cache/eslint/` (`node -e "require('fs').rmSync('node_modules/.cache/eslint',{recursive:true,force:true})"`), else ship serves a stale lint result. Now also noted in `scripts/ship.mjs`.
- Template has **ten** `rihal-template/*` rules at `error` — keep the count consistent if adding more (CLAUDE.md ×2, SECURITY.md ×2, README.md ×2, handoff/ship/conform/first-fork skills, rules.test.mjs header, CHANGELOG.md). CHANGELOG's per-rule "Brings the local plugin to N rules" lines are point-in-time records — do NOT retro-edit.

**Next steps**
1. **PR #37**: offer to watch it (`subscribe_pr_activity`) for CI/review autofix; merge to `main` when approved (main is the fork source-of-truth).
2. More enforce-the-floor candidates if the operator wants to keep iterating: audit-EXCLUDE-set drift guard; `withInternalAuth` bearer-opt-in consistency; a gate that public-path additions in `middleware.ts` are reviewed. (None started.)
3. Each new rule: rule + RuleTester + register at `error` + docs/count refresh; clear eslint cache; `/ship` green; `senior-code-reviewer`; commit + push.
