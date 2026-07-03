# Harness Problems & Remediation Log

Every item that **failed, was blocked, or behaved wrong** when the harness was
exercised end-to-end (see `docs/TRIALS.md` for the full run and
`docs/INVENTORY-BY-OBJECTIVE.md` for the objective map). This is the committed
"must-fix" register: each row has a stable ID, a root cause, and a status.

**Status key:** ✅ FIXED (this repo) · 🌐 ENV-GAP (external prerequisite — cannot
be fixed from the repo; documented so it isn't rediscovered) · 🧭 PROCESS (an
agent/process error, corrected) · ⏸️ DEFERRED (needs an operator decision or a
resource this container lacks) · ➖ NOT-A-DEFECT (works as designed).

_Trial + remediation date: 2026-07-03. Env: remote container, no local DB, live
Neon/Vercel/GitHub tokens present, `ANTHROPIC_API_KEY` unset._

---

## A. Fixed this session

| ID | Problem | Root cause | Fix | Verify |
|----|---------|-----------|-----|--------|
| **P-01** | 3 ESLint **warnings** on `npm run lint` (2× `set-state-in-effect`, 1× `incompatible-library`) | React-Compiler advisories on correct code: two data-fetch-on-mount effects flip loading state synchronously; `DataTable`'s TanStack `useReactTable` returns non-memoizable functions the compiler can't optimize | Narrow justified `eslint-disable-next-line` on each site with a one-line rationale (CLAUDE.md-sanctioned single-line suppressions), in `AuditLogClient.tsx:76`, `recycling-bin/page.tsx:112`, `DataTable.tsx:272` | `npm run lint` → 0 warnings / 0 errors |
| **P-02** | 1 **moderate** `npm audit` vuln — `js-yaml` quadratic-complexity DoS | `js-yaml@3.14.2` pulled transitively by `@changesets/cli` → `@manypkg/get-packages` → `read-yaml-file@1.1.0` (a dev-only tool, never shipped) | Scoped `overrides: { "read-yaml-file": "^2.1.0" }` in `package.json` (v2.1.0 uses `js-yaml ^4`, same `.sync` API `@manypkg` needs) | `npm audit` → **0 vulnerabilities**; `npx changeset` still runs |
| **P-03** | `audit:warn` surfaced the same moderate vuln | Same root cause as P-02 | Resolved by P-02 | `npm run audit:warn` → clean |
| **P-04** | `install-senior-review.mjs` **mutated `AGENTS.md`** when run against the template itself (not read-only) | `upsertAgentsMandate()` was called unconditionally and always `writeFile`d, even when the target was `TEMPLATE_ROOT` and content was current | Skip the mandate upsert entirely when `target === TEMPLATE_ROOT`; and write-only-if-changed for foreign repos (idempotent re-runs no longer churn) | Self-run leaves `git status` clean |
| **P-05** | Playwright MCP unusable — `Browser "chrome-for-testing" is not installed` | `@playwright/mcp@0.0.76 --browser chromium` still resolves to the `chrome-for-testing` channel, which isn't present; the pre-installed Chromium lives at `/opt/pw-browsers/chromium-*` | `.mcp.json` playwright server now launches via `sh -c` with a dynamic `--executable-path "$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | sort -V | tail -1)"` (build-number-proof) | Chromium binary launches (`--dump-dom`); **MCP reload requires a new session** |
| **P-06** | Count errors in `docs/INVENTORY-BY-OBJECTIVE.md` (found by `senior-code-reviewer`) | ADR corpus mislabeled "32+template" (actually 31 numbered + template = 32 files); glance-table C/D totals didn't match rows; bare `uat` npm action had no row; "44→43 predates a script removal" was an unsupported narrative (git shows 43 from day one) | Corrected all three ADR spots to 31+template; fixed glance C=38/D=15/G=41 with a counting-convention note; added the `uat` (npm) row; reworded the 44/43 note to "miscount at authoring time" | Recounted via `awk`/`ls`; internally consistent |

## B. Process errors (corrected)

| ID | Problem | Root cause | Correction |
|----|---------|-----------|-----------|
| **P-07** | 🧭 Reported "no `DATABASE_URL` in env / no DB" and asked how to get one — without checking `.env` | Scanned only the shell `process.env`, then **assumed** no DB config existed, instead of checking the `.env` file the app/Prisma actually load | Corrected: `.env` **does** define `DATABASE_URL` (+ `SEED_ADMIN_EMAIL`/`PASSWORD`). Lesson logged: scan the actual config surface before concluding absence. (The URL still points at an unreachable `localhost:5432` — see P-08 — but the assumption was the error.) |

## C. Environment gaps — cannot be fixed from the repo (documented)

| ID | Blocked item(s) | Root cause | What it would take |
|----|-----------------|-----------|--------------------|
| **P-08** | `prisma:migrate/seed/push/studio`, `test:integration` (3 skips), `manual-uat:users`, `uat`, `qa`, `design-qa`, `manual-uat`, `dev`, `start` | **No reachable Postgres**: Docker daemon is down and won't start (no rootless daemon), there's no local PG server binary (`pg_ctl`/`initdb`/`postgres` absent), and `.env`'s `DATABASE_URL` is a `localhost:5432` placeholder (`prisma migrate status` → `P1001`) | A real DB: either start Docker + `make db-up`, or **provision a Neon branch** via `NEON_API_KEY` (present), run `prisma migrate deploy` + `prisma db seed`, then tear down. Operator decision pending (see §E). |
| **P-09** | `cover` (AI test-gen), `batch` (headless `claude -p`), senior-review **CI** gate | `ANTHROPIC_API_KEY` is **unset** in this container | Set `ANTHROPIC_API_KEY` (Vercel/CI secret). The in-session `senior-code-reviewer` agent works without it; only the headless/CI paths need it. |
| **P-10** | `uat` / `design-qa` / `manual-uat` login step | No seeded admin creds usable (`UAT_EMAIL`/`UAT_PASSWORD` unset; `SEED_ADMIN_*` exist in `.env` but there's no DB to seed into — P-08) | Seed an admin into a live DB, then set `UAT_EMAIL`/`UAT_PASSWORD` (or reuse `SEED_ADMIN_*`) |
| **P-11** | `audit` (SAST leg), `conform` | `semgrep` binary absent | `pipx install semgrep` (or the Docker fallback in the skill). gitleaks + npm-audit legs still run. |
| **P-12** | `docker` skill, `/handoff` image gate | Docker daemon down / unavailable in this sandbox | Run where a Docker daemon is available |
| **P-13** | `Replit` MCP | Requires interactive OAuth; non-interactive session can't authorize | Authorize via claude.ai connector settings / `claude mcp` in an interactive session |
| **P-14** | `analyze`, `scan` (react-scan), `lhci` | Need a running app (and a heavy ANALYZE build); no app running here | Run against `npm run dev` / a deployed URL |
| **P-15** | `uat:pdf`, `uat:benchmark`, `uat:full`, `uat:headed`, `uat:report` | Need full-UAT JSON inputs / a browser+creds / a prior report | Produced by a completed `/uat` run (depends on P-08 + P-10) |
| **P-16** | `migrate-from` | Needs a source **and** a target Postgres + `--map` | Two live DBs + a column→field map |

## D. Not defects (recorded for completeness)

| ID | Item | Note |
|----|------|------|
| **P-17** | ➖ `rebrand` live-run | Verified via `--dry-run` (5 files). **Intentionally not run live** — it rewrites the *template's own* identity; it's meant for forks, not the source-of-truth template. Operator chose to skip. |
| **P-18** | ➖ `changeset` / `changeset:version` | Interactive; not run in a non-interactive session. CLI loads fine (verified post-P-02). |
| **P-19** | ➖ `sbom` `punycode` deprecation warning | Benign Node core deprecation from a transitive dep; not actionable here. |

## E. Open operator decision

- **P-08 (DB).** The only path to a running Postgres in this container is
  provisioning a **live Neon branch** (`NEON_API_KEY` is present) — Docker can't
  start and there's no local PG. That creates a real (short-lived) cloud DB.
  Awaiting a go/no-go before provisioning, since it touches the operator's Neon
  account. Once a DB exists, P-08/P-10/P-15's blocked items can all run
  (migrate → seed → integration tests → `manual-uat:users` → `uat`).

---

## Scoreboard

- **Fixed in-repo:** P-01…P-06 (lint, js-yaml, audit:warn, install-senior-review,
  Playwright MCP config, inventory-doc counts).
- **Process correction:** P-07.
- **Env-gaps logged (not repo-fixable):** P-08…P-16.
- **Not defects:** P-17…P-19.
- **Pending decision:** P-08 (Neon provisioning).
