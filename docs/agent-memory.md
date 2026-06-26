# Agent memory (durable, cross-session)

Long-lived knowledge that should survive across sessions **and** propagate to
forks (this file lands on `main`; forks inherit it at fork time). It is the
durable counterpart to `docs/SESSION-HANDOFF.md` — that file is transient
in-flight state on a working branch; **this** file is decisions, gotchas, and
conventions worth keeping.

The `SessionStart` hook surfaces this file into the session, so every line is a
recurring context tax — same discipline as CLAUDE.md.

## How to use it
- Append a one-line, **dated** entry to the right section (newest at top of each
  section). Use `/remember "<entry>"`, or it accrues automatically when
  `/handoff-session` promotes its "Decisions".
- **Curation rule — keep it bounded (~150 lines).** When an entry becomes a
  stable rule, promote it into CLAUDE.md or an ADR and delete it here. Prune
  entries that no longer apply. If this file is consistently over budget, the
  fix is promotion + pruning, not a bigger budget.
- One fact per line: `YYYY-MM-DD — <fact>` (add `(ADR-NNN)` / `file:line` when
  there is a canonical home).
- **Never write secrets, passwords, tokens, or Restricted values here.** This
  file is tracked, lands on `main`, is inherited by forks, and is printed into
  every session at startup — treat it like CLAUDE.md, not like `.env`.

## Durable decisions
<!-- choices made with the operator, so they are not relitigated -->
- 2026-06-25 — Harness-hardening sweep (15 operator complaints) is COMPLETE and the
  "tiered blocking gate · hard hooks" roadmap is implemented (ADR-025): pillars-as
  -gates + the `Stop` hook hard-BLOCKS unpushed commits + `/ship` blueprint & tier
  gates (blueprint/tier block on `shared`, warn on `personal`; escapes are recorded
  `*Ack` keys / adjudicated register lines, never silent). Native design system =
  ADR-026 (built, not imported — consistent with the ADR-022 native-over-imported
  call). Don't relitigate these — read the ADRs.
- 2026-06-20 — Adopted cross-session agent memory as committed Markdown + model
  routing as a documented tier table; evaluated and rejected ruflo wholesale
  (unverified claims, destructive-preinstall history, off-Anthropic egress,
  `--dangerously-skip-permissions`). (ADR-022)

## Gotchas & landmines
<!-- non-obvious traps a future session must not trip on; prefer a code/ADR pointer -->
- 2026-06-26 — **CORRECTION (supersedes the prior "no local Postgres" claim):
  authenticated browser QA on a faithful LOCAL carbon-copy IS achievable in this
  container — PROVEN.** Postgres 16 is installed at `/usr/lib/postgresql/16/bin`
  (no docker needed). Recipe (run the cluster as the `postgres` system user —
  PG refuses root): `mkdir -p /tmp/pgqa/data && chown -R postgres:postgres
  /tmp/pgqa` → `runuser -u postgres -- $PGBIN/initdb -D /tmp/pgqa/data -U postgres
  --auth=trust` → `pg_ctl -D … -o "-p 5433 -k /tmp/pgqa" -w start` → `createdb …
  appdb`. Then with `DATABASE_URL=postgresql://postgres@localhost:5433/appdb?schema=public`:
  `npx prisma migrate deploy` + `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run
  prisma:seed`. Start dev with that DATABASE_URL + `AUTH_TRUST_HOST=true
  AUTH_URL=http://localhost:3000`, then `UAT_BASE_URL=http://localhost:3000
  SEED_ADMIN_* npm run uat` — chromium reaches localhost (noProxy); all 9 lean
  UAT screens passed authenticated (dashboard/users/audit/recycling/settings/
  style-guide). Caveat: NOT a substitute for *deploy-specific* checks (CSP nonces,
  Vercel headers, prod build, prod data) — for those use the live URL. Two real
  limits remain: (a) bundled Chromium still cannot traverse the MITM proxy to a
  `*.vercel.app` host (page.goto → ERR_CONNECTION_CLOSED; curl works); (b) the
  Playwright **MCP** tools + AskUserQuestion/ExitPlanMode intermittently error
  "Tool permission stream closed" — so drive the browser via the repo's
  `npm run uat` (Playwright test runner), NOT the MCP, for reliability. Also: the
  container restarts mid-task and kills background servers (DB *data* under
  /tmp survived a restart; the running processes did not — just re-`pg_ctl start`).
- 2026-06-26 — Auth.js v5 credentials login via raw curl/fetch returns
  `?error=MissingCSRF` unless the `__Host-authjs.csrf-token` cookie is threaded
  exactly (GET /api/auth/csrf cookie → POST /api/auth/callback/credentials).
  Browsers do this automatically; for a headless auth smoke prefer a real browser
  or carefully forward the __Host- csrf cookie. Not an app bug.
- 2026-06-26 — First-deploy env-var race (#50): BOTH scripts/deploy.mjs AND
  scripts/new-project.mjs must set all 6 env vars (incl CRON_SECRET) and
  poll-confirm them via `GET /v9/projects/:id/env` BEFORE triggering the first
  deploy — else the first build runs without CRON_SECRET (dead audit-purge cron)
  / SEED_ADMIN_* (no admin). The Vercel build already seeds (vercel.json); #51
  was a symptom of #50. seed.ts skips cleanly (exit 0) in prod with no password.
- 2026-06-26 — `AskUserQuestion` failed repeatedly in this remote env ("Tool
  permission stream closed before response received"). If it errors twice, stop
  retrying and pose decisions as plain text in the reply.
- 2026-06-25 — **STOP claiming "I can't run build/browser/deploy" — VERIFY first.**
  Probed this env: `next build` works (exit 0; `@next/swc-linux-x64-gnu` loads,
  glibc 2.39). Playwright MCP + Chromium present at `/opt/pw-browsers`. `VERCEL_TOKEN`
  + `NEON_API_KEY` are SET; egress to api.vercel.com (403 unauth) + console.neon.tech
  (401 unauth) is OPEN (real auth-level responses, not proxy blocks). The mid-session
  `next build` failure was TRANSIENT: SessionStart had just reinstalled 183 pkgs and
  the gnu SWC binary wasn't installed yet — it resolves once deps settle. So `/ship`
  -> `/deploy` -> live URL -> Playwright screenshot is a CLOSED loop here. Don't push
  `--no-verify` by default; run the real gate. The only true prerequisite for a
  screenshot is a running URL (`npm run dev` localhost, or a deployed preview).
- 2026-06-25 — `/ship` scalability scan (`scripts/ship.mjs` `scanScalability`)
  tests bound tokens (take/skip/cursor/paginat) against each `.findMany(` CALL
  SITE (~250 chars after the call), NOT file-wide — a comment word "take"/"skip"
  must not mask a genuinely unbounded query. `walkRoutes` guards `statSync` so a
  broken symlink under `app/api` can't hard-kill `/ship`. Per-file waiver marker:
  `pillar:scalable-ok` (+ a register line).
- 2026-06-26 — gitleaks-on-fresh-container is now AUTO-FIXED in the template:
  `.claude/hooks/session-start.sh` installs gitleaks v8.21.2 → `~/.local/bin`
  (fail-open, gated on missing) and `scripts/ship.mjs` prefers that exact path,
  so PATH need not include `~/.local/bin`. Manual install only needed if the
  hook's download was blocked (offline egress). Supersedes the 2026-06-24 note.
- 2026-06-24 — SessionStart hook now installs deps / regenerates the Prisma client
  on **stale** (package.json or schema.prisma newer than node_modules/generated),
  not just missing (`.claude/hooks/session-start.sh`, ADR-023 commit) — this fixes
  the trap below. Until that lands on `main`, the manual workaround still applies.
- 2026-06-20 — SessionStart hook installs deps / generates the Prisma client only
  when **missing, not stale**. After checking out a branch whose `package.json` or
  `prisma/schema.prisma` moved ahead, run `npm install` + `npx prisma generate`
  before `/ship` or typecheck fails on phantom missing modules / fields.
- 2026-06-20 — Fresh containers can have local `main` far behind `origin/main`.
  Before fast-forward-merging a working branch into `main`, verify `origin/main`
  is an ancestor of the branch (`git merge-base --is-ancestor origin/main <branch>`)
  so the FF doesn't strand remote commits.

## Conventions discovered
<!-- patterns/idioms established in practice that are not yet written down elsewhere -->
- (none yet — promote stable ones into CLAUDE.md / an ADR, then remove here)
