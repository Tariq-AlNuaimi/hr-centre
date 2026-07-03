# Handoff → Next Session (harness remediation)

**Branch:** `claude/inventory-by-objective-ir9zi8` · **Last `/ship`: green** ·
all work below is **pushed** (verify: `git rev-list --count @{u}..HEAD` → 0).
Do NOT merge to `main` unless the operator asks.

## ✅ DONE this session (DB session, 2026-07-03) — NA1 + NA2

**NA1 (DB items) — CLEARED, but via a LOCAL Postgres, not Neon.** Operator approved
Neon provisioning; on execution the Neon *API* works (throwaway project created + torn
down, **0 orphans**) but raw Postgres **:5432 egress is blocked** by this container's
HTTPS-only proxy, so a Neon branch can be created but never connected to from here. A
**local `postgresql-16` cluster** (already installed under `/usr/lib/postgresql/16`,
cluster `16/main` — correcting P-08's "no local PG" claim) was used instead:
- `prisma migrate deploy` ✅ · `prisma db seed` ✅ (admin@example.com)
- `test:integration` ✅ **3 pass / 0 skip** (the 3 DB-gated cases now execute)
- `manual-uat:users` ✅ · lean `uat` ✅ **37 passed**
- Fixed a latent bug found by the first real `npm run uat`: `design-a11y.uat.ts`
  wrongly applied the "did not bounce to /login" guard to the login screen itself.
- Playwright **MCP** is still unusable in a harnessed session (harness-injected
  `/tmp/mcp-config-*.json` overrides the repo `.mcp.json` P-05 fix); the **project
  Playwright** is the working browser driver (drove all 37 specs). See HARNESS-PROBLEMS §F.

**NA2 (env-gaps) — adjudicated.** Operator chose **wire the semgrep bootstrap only**
(P-11): the `/audit` skill SAST step now self-installs semgrep (`pipx` → `pip --user`
→ Docker). Install verified here; runtime still blocked by a broken system
`cryptography`/pyo3 binding in this base image (documented, not repo-fixable). P-09 and
the four pure-env gaps (P-12/13/14/16) stay **documented/accepted** — not repo-fixable.
`rebrand` live stays skipped (P-17). See HARNESS-PROBLEMS.md §C/§F for the full record.

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

> **RESOLVED — see the "✅ DONE this session" block at the top of this file +
> `HARNESS-PROBLEMS.md §F`.** NA1 (P-08/P-10/P-15) and NA2 (env-gap adjudication)
> are both done and pushed; do NOT redo them. The original plan is kept below,
> struck through, only as the historical record of what was executed.

### 1. ~~Provision a DB and clear the DB-blocked items (P-08/P-10/P-15)~~ ✅ DONE
~~Provision a live Neon branch~~ — **superseded:** Neon is unusable from this
container (`:5432` egress blocked, §F). Cleared instead against the **local
`postgresql-16` cluster** (`pg_ctlcluster 16 main start`): migrate + seed +
`test:integration` (3 pass / 0 skip) + `manual-uat:users` + lean `uat` (37
passed). The Neon probe project was created + torn down (0 orphans). The
`design-a11y.uat.ts` login-guard bug found here was fixed. **Reuse the local PG
cluster next time — it needs no egress; do NOT re-provision Neon for DB work.**

### 2. ~~Adjudicate the remaining `HARNESS-PROBLEMS.md` items~~ ✅ DONE
Operator chose **wire the semgrep bootstrap only** (P-11, now in the `/audit`
skill). P-09 + the pure-env gaps (P-12/13/14/16) are **documented/accepted** —
not repo-fixable. P-17/P-18/P-19 remain not-defects.

### 3. Close out ✅ DONE
`/ship` green → commit `ae0c22a` → pushed to `claude/inventory-by-objective-ir9zi8`
→ verified (0 unpushed). Not merged to `main`. Registers updated (§C/§F + this file).

### What actually remains for a future session
- P-11 semgrep **runs** only on a host without this base image's broken
  `cryptography`/pyo3 binding (the bootstrap self-installs it there); or use the
  Docker fallback once a Docker daemon is available (P-12).
- P-09 `ANTHROPIC_API_KEY`: operator sets it as a GitHub Actions / Vercel secret
  to light up the dormant senior-review CI + `/cover`/`/batch` headless paths.
- P-13/P-14/P-16 stay environment-gated (Replit OAuth / a running app / two DBs).

## Guardrails
- Ask-before surface untouched so far. `.mcp.json`/`package.json overrides` are
  not Ask-before; a **Neon provision** is operator-approved (done).
- `rebrand` live is **skipped by decision** (P-17) — do not run it on the template.
- Push completed work before the session ends (Stop hook hard-blocks unpushed).
