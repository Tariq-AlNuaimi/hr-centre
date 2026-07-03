# Handoff → Next Session (harness remediation)

**Branch:** `claude/inventory-by-objective-ir9zi8` · **Last `/ship`: green** ·
all work below is **pushed** (verify: `git rev-list --count @{u}..HEAD` → 0).
Do NOT merge to `main` unless the operator asks.

## Already done & pushed (do not redo)
Commits land the remediation of `docs/HARNESS-PROBLEMS.md` P-01…P-06:
- **P-01** lint: 3 React-Compiler warnings cleared via justified single-line
  `eslint-disable` (`AuditLogClient.tsx:76`, `recycling-bin/page.tsx:112`,
  `DataTable.tsx:272`). `npm run lint` clean.
- **P-02/P-03** js-yaml moderate vuln: `overrides.read-yaml-file: ^2.1.0` in
  `package.json`. `npm audit` → **0 vulns**.
- **P-04** `scripts/install-senior-review.mjs`: read-only no-op on template
  self-run (skip mandate when `target===TEMPLATE_ROOT`; write-only-if-changed).
- **P-05** `.mcp.json` playwright: dynamic `--executable-path` glob to the
  pre-installed Chromium. **Takes effect THIS session** — so the browser-QA tier
  (design-qa/uat/manual-uat via MCP) should now actually launch. Verify early.
- **P-06** `docs/INVENTORY-BY-OBJECTIVE.md` count fixes (ADR 31+template, glance
  C=38/D=15/G=41, added `uat` npm row, 44/43 wording).
- **P-07** process note logged (scan-then-assume on the DB).

## Next actions (in order)

### 1. Provision a DB and clear the DB-blocked items (P-08/P-10/P-15) — operator said YES
There is NO reachable Postgres in the container (Docker daemon down, no local PG
binary, `.env` `DATABASE_URL` is a `localhost:5432` placeholder). Provision a
**live Neon branch** with `NEON_API_KEY` (present):
1. Create a temporary Neon project/branch via the Neon API (reuse the patterns in
   `scripts/deploy.mjs` / `scripts/new-project.mjs` — they already do Neon
   create + `teardown()`/`bailWithRollback`). Capture its connection string into
   the process env / a scratch `.env` **without printing the value**
   (protect-secrets blocks echoing `DATABASE_URL`).
2. `prisma migrate deploy` then `prisma db seed` (seeds `SEED_ADMIN_*` from
   `.env`).
3. Run and confirm: `npm run test:integration` (the **3 skips** should now
   execute), `npm run manual-uat:users`, and lean `npm run uat`
   (`UAT_EMAIL`/`UAT_PASSWORD` = the seeded `SEED_ADMIN_EMAIL`/`PASSWORD`).
4. Optionally drive **design-qa**/**manual-uat** now that the Playwright MCP fix
   (P-05) is live.
5. **Tear the Neon branch down** and verify 0 orphan projects (the trials proved
   `deploy.mjs` teardown works — reuse it; never leave a stray project).

### 2. Adjudicate the remaining `HARNESS-PROBLEMS.md` items
The operator asked to "implement everything." P-09 (`ANTHROPIC_API_KEY` unset),
P-11 (semgrep absent), P-12 (docker daemon), P-13 (Replit OAuth), P-14 (running
app), P-16 (two DBs) are **environment gaps — not repo-fixable**. Don't fake
fixes: for each, either (a) document the exact external step in the register
(already there) and mark it accepted, or (b) if the operator wants them
enforced, wire the enabling config (e.g. add `ANTHROPIC_API_KEY` to CI secrets,
add a `pipx install semgrep` bootstrap step to the audit skill / setup). Confirm
which they want before doing (b). P-17/P-18/P-19 are not-defects — leave as-is.

### 3. Close out
`/ship` green → commit → push → verify. Then update
`docs/HARNESS-PROBLEMS.md` statuses (P-08/P-10/P-15 → FIXED once the DB run
passes) and this file.

## Guardrails
- Ask-before surface untouched so far. `.mcp.json`/`package.json overrides` are
  not Ask-before; a **Neon provision** is operator-approved (done).
- `rebrand` live is **skipped by decision** (P-17) — do not run it on the template.
- Push completed work before the session ends (Stop hook hard-blocks unpushed).
