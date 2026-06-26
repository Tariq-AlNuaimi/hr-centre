# Session handoff

> New session: we are mid-stream on fullstack-vibe-template. Read this, confirm
> the branch matches, then start on "Next steps" item 1. Don't re-explore what
> it answers.

## Goal
Operator wants (a) the 3 per-fork template defects fixed (#50/#51/#52 — DONE),
(b) Arabic/RTL made **optional** ("don't need it in most apps"), and (c) the
design system revised to an **enterprise/sellable** look using AntD fully
(operator: current UI "looks amateur"). (b)+(c) are PLANNED, awaiting sign-off.

## State
- Branch: `claude/template-defects-deploy-seed-uat-0q7kb0` — **in sync** with
  origin (`@{u}..HEAD` = 0). NOT the stale `…-h0iy7g` / `…-42ng02` / `…-1yxbgl`.
- Working tree clean (this handoff is the only pending commit).
- Last `/ship`: GREEN (typecheck/lint/tests/build/gitleaks/npm-audit). Not deployed.
- Setup for /ship in a fresh container: install gitleaks to ~/.local/bin (v8.21.2)
  + `export PATH="$HOME/.local/bin:$PATH"`; `npm ci` + `npx prisma generate` if needed.

## Done (this session, pushed)
- `7b55d07` fix(template): #50 deploy.mjs env-confirm-before-deploy + post-deploy
  CRON_SECRET probe; #51 seed.ts clean-skip (build already seeds via vercel.json);
  #52 playwright Chromium executablePath hook + README.
- `93e0eab` fix(deploy): senior-review follow-ups — null-guard deploy status,
  JSON-keyed cron probe, **new-project.mjs got CRON_SECRET + env-confirm loop too**
  (closes #50 on the Actions path), PW_EXECUTABLE_PATH existsSync validation.
- `ff18133` docs(blueprint): `docs/blueprints/enterprise-design-system-and-i18n.md`
  — the full plan for asks (b) + (c).

## In flight
None — code is landed; (b)+(c) are not started (blocked on operator decisions).

## Decisions (made / pending)
- DONE: #51 is really #50 (build already seeds; the bug was env vars missing on
  first build). Both deploy.mjs AND new-project.mjs now poll-confirm all 6 env
  vars before the first deploy.
- PENDING (operator) — see blueprint "Decisions needed". My recommendations:
  1. i18n: **config flag, default English-only** (keep ar.json, opt-in per fork).
  2. design scope: **full overhaul, Phases 0–4**.
  3. white-label: **yes, one brand.config per client**.
- Kept on AntD (ADR-027); elevate, don't swap.

## Landmines
- `AskUserQuestion` repeatedly failed this session ("Tool permission stream
  closed") — pose decisions as plain text instead of relying on the picker.
- `middleware.ts` is Ask-before → plan + `/code-review` before the i18n change.
- Don't "optimize away" the findUnique pre-check before update/delete on
  soft-deletable models (ADR-029 §7). Don't re-fight the 13 moderate @changesets
  dev CVEs (SECURITY.md §13). Don't "fix" AntD 6 Space `orientation`.

## Next steps
1. Get the operator's answers to the 3 blueprint decisions (plain text).
2. Implement Part 1 (Arabic/RTL optional) on `feat/i18n-optional-rtl` per the
   blueprint — `locales` in project.config.json, shared `localePrefixRegex`,
   direction map, switcher hides when 1 locale. `/code-review` (middleware.ts).
3. Then execute the chosen design-system phase(s) — Phase 0 (brand.config + load
   font) first. `/ship` green + push after each phase.
4. Once UI is reshaped: re-`/deploy` a preview, seed auto-runs (#51), then
   `UAT_BASE_URL=… SEED_ADMIN_* npm run uat` → `/design-qa` → `/manual-uat`.
