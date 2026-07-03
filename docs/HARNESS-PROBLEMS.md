# Harness Problems & Remediation Log

Every item that **failed, was blocked, or behaved wrong** when the harness was
exercised end-to-end (see `docs/TRIALS.md` for the full run and
`docs/INVENTORY-BY-OBJECTIVE.md` for the objective map). This is the committed
"must-fix" register: each row has a stable ID, a root cause, and a status.

**Status key:** ✅ FIXED (this repo) · ✅→§F CLEARED at runtime via a local
Postgres (see §F) · ⚙️wired enabling config wired in-repo, but still runtime-blocked
by an env defect (see the row) · 🌐 ENV-GAP (external prerequisite — cannot be fixed
from the repo; documented so it isn't rediscovered) · 🧭 PROCESS (an agent/process
error, corrected) · ⏸️ DEFERRED (needs an operator decision or a resource this
container lacks) · ➖ NOT-A-DEFECT (works as designed).

_Trial + remediation date: 2026-07-03. Env: remote container, no local DB, live
Neon/Vercel/GitHub tokens present, `ANTHROPIC_API_KEY` unset._

**Update 2026-07-03 (DB session):** P-08/P-10/P-15 are now **CLEARED** — the DB-blocked
items were run to green against a **local PostgreSQL 16 cluster**, not Neon. Two findings
drove that (see §F): (1) Neon's control API is reachable but raw Postgres **:5432 egress is
blocked** by this container's HTTPS-only proxy, so a provisioned Neon branch can be *created*
but never *connected to* from here — the blocker was never the `NEON_API_KEY`; (2) a local
`postgresql-16` server IS installed (`/usr/lib/postgresql/16`, cluster `16/main`), so P-08's
"no local PG server binary" was wrong — a local cluster sidesteps egress entirely. P-05 is
also corrected below (repo fix is right; the harness-session MCP config overrides it).

---

## A. Fixed this session

| ID | Problem | Root cause | Fix | Verify |
|----|---------|-----------|-----|--------|
| **P-01** | 3 ESLint **warnings** on `npm run lint` (2× `set-state-in-effect`, 1× `incompatible-library`) | React-Compiler advisories on correct code: two data-fetch-on-mount effects flip loading state synchronously; `DataTable`'s TanStack `useReactTable` returns non-memoizable functions the compiler can't optimize | Narrow justified `eslint-disable-next-line` on each site with a one-line rationale (CLAUDE.md-sanctioned single-line suppressions), in `AuditLogClient.tsx:76`, `recycling-bin/page.tsx:112`, `DataTable.tsx:272` | `npm run lint` → 0 warnings / 0 errors |
| **P-02** | 1 **moderate** `npm audit` vuln — `js-yaml` quadratic-complexity DoS | `js-yaml@3.14.2` pulled transitively by `@changesets/cli` → `@manypkg/get-packages` → `read-yaml-file@1.1.0` (a dev-only tool, never shipped) | Scoped `overrides: { "read-yaml-file": "^2.1.0" }` in `package.json` (v2.1.0 uses `js-yaml ^4`, same `.sync` API `@manypkg` needs) | `npm audit` → **0 vulnerabilities**; `npx changeset` still runs |
| **P-03** | `audit:warn` surfaced the same moderate vuln | Same root cause as P-02 | Resolved by P-02 | `npm run audit:warn` → clean |
| **P-04** | `install-senior-review.mjs` **mutated `AGENTS.md`** when run against the template itself (not read-only) | `upsertAgentsMandate()` was called unconditionally and always `writeFile`d, even when the target was `TEMPLATE_ROOT` and content was current | Skip the mandate upsert entirely when `target === TEMPLATE_ROOT`; and write-only-if-changed for foreign repos (idempotent re-runs no longer churn) | Self-run leaves `git status` clean |
| **P-05** | Playwright MCP unusable — `Browser "chrome-for-testing" is not installed` | `@playwright/mcp@0.0.76 --browser chromium` still resolves to the `chrome-for-testing` channel, which isn't present; the pre-installed Chromium lives at `/opt/pw-browsers/chromium-*` | `.mcp.json` playwright server now launches via `sh -c` with a dynamic `--executable-path "$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome \| sort -V \| tail -1)"` (build-number-proof) | Repo fix VERIFIED correct (targets the existing `/opt/pw-browsers/chromium-1194/…/chrome`). **CAVEAT (§F):** in a harnessed web session the MCP is launched from the harness-injected `/tmp/mcp-config-*.json` (`--browser chromium`, no exec-path), which the repo `.mcp.json` does NOT govern — so the MCP browser is still unusable *in-session* here. The reliable browser driver in this env is the **project Playwright** (`npm run uat` / `npx playwright test`), which the P-15 run exercised (37 passed). |
| **P-06** | Count errors in `docs/INVENTORY-BY-OBJECTIVE.md` (found by `senior-code-reviewer`) | ADR corpus mislabeled "32+template" (actually 31 numbered + template = 32 files); glance-table C/D totals didn't match rows; bare `uat` npm action had no row; "44→43 predates a script removal" was an unsupported narrative (git shows 43 from day one) | Corrected all three ADR spots to 31+template; fixed glance C=38/D=15/G=41 with a counting-convention note; added the `uat` (npm) row; reworded the 44/43 note to "miscount at authoring time" | Recounted via `awk`/`ls`; internally consistent |

## B. Process errors (corrected)

| ID | Problem | Root cause | Correction |
|----|---------|-----------|-----------|
| **P-07** | 🧭 Reported "no `DATABASE_URL` in env / no DB" and asked how to get one — without checking `.env` | Scanned only the shell `process.env`, then **assumed** no DB config existed, instead of checking the `.env` file the app/Prisma actually load | Corrected: `.env` **does** define `DATABASE_URL` (+ `SEED_ADMIN_EMAIL`/`PASSWORD`). Lesson logged: scan the actual config surface before concluding absence. (The URL still points at an unreachable `localhost:5432` — see P-08 — but the assumption was the error.) |

## C. Environment gaps — cannot be fixed from the repo (documented)

| ID | Blocked item(s) | Root cause | What it would take |
|----|-----------------|-----------|--------------------|
| **P-08** ✅→§F | `prisma:migrate/seed/push/studio`, `test:integration` (3 skips), `manual-uat:users`, `uat`, `qa`, `design-qa`, `manual-uat`, `dev`, `start` | **No reachable Postgres** *(at trial time)*: Docker daemon down; `.env`'s `DATABASE_URL` was a `localhost:5432` placeholder (`P1001`). NOTE: the "no local PG server binary" claim was WRONG — `initdb`/`postgres`/`pg_ctl` exist under `/usr/lib/postgresql/16/bin` (not on `PATH`), and cluster `16/main` was already present, just down. | **CLEARED (§F):** started the local `16/main` cluster, `prisma migrate deploy` + `prisma db seed` + `test:integration` (now **3 pass / 0 skip**) all green. (A Neon branch is NOT viable from this container — `:5432` egress is blocked; see §F.) |
| **P-09** | `cover` (AI test-gen), `batch` (headless `claude -p`), senior-review **CI** gate | `ANTHROPIC_API_KEY` is **unset** in this container | Set `ANTHROPIC_API_KEY` (Vercel/CI secret). The in-session `senior-code-reviewer` agent works without it; only the headless/CI paths need it. |
| **P-10** ✅→§F | `uat` / `design-qa` / `manual-uat` login step | No seeded admin creds usable (`UAT_EMAIL`/`UAT_PASSWORD` unset; `SEED_ADMIN_*` exist in `.env` but there was no DB to seed into — P-08) | **CLEARED (§F):** seeded `SEED_ADMIN_EMAIL` into the local cluster; lean `uat` logged in with `SEED_ADMIN_*` and passed all 37 specs. |
| **P-11** ⚙️wired | `audit` (SAST leg), `conform` | `semgrep` binary absent | **Bootstrap WIRED (operator-approved, 2026-07-03):** the `/audit` skill's SAST step now self-installs semgrep (`command -v semgrep \|\| pipx install semgrep \|\| pip install --user semgrep`) before the Docker fallback. Verified: `pip install --user semgrep` succeeds here (semgrep 1.168.0). **Container caveat:** semgrep then *can't run in THIS sandbox* — the system `cryptography`/pyo3 rust binding is broken (`_cffi_backend` missing → `pyo3_runtime.PanicException`), which a venv can't dodge without a working build toolchain. So on a healthy machine/CI the bootstrap makes the SAST leg self-heal; in this specific container it's still blocked by a base-image crypto defect. gitleaks + npm-audit legs run regardless. |
| **P-12** | `docker` skill, `/handoff` image gate | Docker daemon down / unavailable in this sandbox | Run where a Docker daemon is available |
| **P-13** | `Replit` MCP | Requires interactive OAuth; non-interactive session can't authorize | Authorize via claude.ai connector settings / `claude mcp` in an interactive session |
| **P-14** | `analyze`, `scan` (react-scan), `lhci` | Need a running app (and a heavy ANALYZE build); no app running here | Run against `npm run dev` / a deployed URL |
| **P-15** ✅→§F | `uat:pdf`, `uat:benchmark`, `uat:full`, `uat:headed`, `uat:report` | Need full-UAT JSON inputs / a browser+creds / a prior report | **CLEARED (§F):** lean `uat` (37 passed) + `manual-uat:users` ran against the local cluster; `uat-results/results.json` now exists (the input the `:pdf`/`:report` derivatives need). Full-UAT derivatives remain gated only on running `uat:full`. |
| **P-16** | `migrate-from` | Needs a source **and** a target Postgres + `--map` | Two live DBs + a column→field map |

## D. Not defects (recorded for completeness)

| ID | Item | Note |
|----|------|------|
| **P-17** | ➖ `rebrand` live-run | Verified via `--dry-run` (5 files). **Intentionally not run live** — it rewrites the *template's own* identity; it's meant for forks, not the source-of-truth template. Operator chose to skip. |
| **P-18** | ➖ `changeset` / `changeset:version` | Interactive; not run in a non-interactive session. CLI loads fine (verified post-P-02). |
| **P-19** | ➖ `sbom` `punycode` deprecation warning | Benign Node core deprecation from a transitive dep; not actionable here. |

## E. Open operator decision — RESOLVED (2026-07-03)

- **P-08 (DB).** ✅ Resolved. Operator approved Neon provisioning; on execution the
  Neon *API* path worked (project created + torn down, 0 orphans) but raw Postgres
  **:5432 egress is blocked** here, so Neon can't be *connected to* from this container.
  A **local `postgresql-16` cluster** (already installed, just not on `PATH`) was used
  instead — migrate → seed → integration (3 pass / 0 skip) → `manual-uat:users` → lean
  `uat` (37 passed) all green. Full detail in §F.

## F. DB session — resolution, findings, and honest caveats (2026-07-03)

**What ran green (local Postgres 16, `127.0.0.1:5432`, db `harness`):**
- `prisma migrate deploy` — all migrations applied.
- `prisma db seed` — admin `admin@example.com` created (NODE_ENV=development, so the
  production `changeme` guard didn't trip).
- `test:integration` — **3 pass / 0 skip** (the 3 cases that skip when the DB is
  unreachable now execute and pass: CREATE-audit attribution, soft-delete scrub, groupBy filter).
- `manual-uat:users` — printed the EDITOR/VIEWER role logins cleanly.
- lean `uat` (`npx playwright test`, auto-started `npm run dev` against the local DB,
  logged in as the seeded admin) — **37 passed**.

**Finding 1 — Neon `:5432` egress is blocked (not a token problem).** The Neon control
API (`console.neon.tech`) is reachable and `NEON_API_KEY` works — a throwaway project was
created and deleted (0 orphans, teardown pattern from `scripts/deploy.mjs` verified). But a
`pg` client connect to the Neon compute endpoint on **:5432 times out**: this container's
egress is an HTTPS-allowlist proxy that does not tunnel arbitrary TCP. So "provision a Neon
branch" is only half-usable here — you can create it, not connect to it. To use Neon for DB
work you need an environment whose network policy allows outbound `*.neon.tech:5432`.

**Finding 2 — a local Postgres server IS available (corrects P-08).** `initdb`/`postgres`/
`pg_ctl` live under `/usr/lib/postgresql/16/bin` (not on `PATH`, which is why the trial missed
them), and debian cluster `16/main` was already present (down). `pg_ctlcluster 16 main start` +
a password + `createdb` gives a fully local DB with **no egress needed** (`127.0.0.1` is in the
proxy `noProxy` list). This is the fastest DB path in this container — prefer it over Neon here.

**Finding 3 — Playwright MCP still unusable in a harnessed session (refines P-05).** The repo
`.mcp.json` fix is correct, but the web-session MCP is launched from the harness-injected
`/tmp/mcp-config-*.json` (`--browser chromium`, no `--executable-path`), which the repo file
doesn't govern — a direct MCP `browser_navigate` still errors `chrome-for-testing not installed`.
The **project Playwright** (`npm run uat`) is the working browser driver here and drove all 37
uat specs, so design-qa/uat/manual-uat flows that shell out to `npx playwright test` work;
only the flows that call the Playwright *MCP* tools are blocked in-session.

**Bug fixed while proving it — `design-a11y.uat.ts` login-screen guard.** Running the spec via
`npm run uat` (its first real end-to-end run — prior "design-qa" passes used a deployed-app
loopback bridge, never this path) surfaced a latent bug: `auditScreen` asserted "did not bounce
to /login" for *every* non-bounce screen, including the `login` screen itself (which legitimately
lives at `/login`), so both login audits always failed. Fixed by skipping that guard when the
audited screen's own path is the login route. Re-run: **37 passed, 0 failed.**

---

## Scoreboard

- **Fixed in-repo:** P-01…P-06 (lint, js-yaml, audit:warn, install-senior-review,
  Playwright MCP config, inventory-doc counts) + the `design-a11y.uat.ts` login-guard bug (§F).
- **Process correction:** P-07.
- **DB items cleared via a local PG cluster (§F):** P-08, P-10, P-15 (migrate/seed/integration/
  manual-uat/lean-uat all green).
- **Enabling config wired in-repo (hybrid):** P-11 — the `/audit` semgrep bootstrap is fixed
  in-repo; only the *runtime* is still blocked, and only in this base image (broken system
  `cryptography`/pyo3). It self-heals on a healthy host/CI.
- **Env-gaps still logged (not repo-fixable):** P-09, P-12, P-13, P-14, P-16 — see §C /
  the Handoff NA2 decision.
- **Not defects:** P-17…P-19.
- **Pending decision:** none (P-08 resolved).
