# Session handoff

> New session: we are mid-stream on fullstack-vibe-template (enterprise design
> overhaul + optional i18n). Read this, confirm the branch, then continue at
> "Next steps". Don't re-explore what it answers.

## Goal
Make the template look enterprise/sellable (operator: current UI "looks
amateur") and make Arabic/RTL optional. Blueprint:
`docs/blueprints/enterprise-design-system-and-i18n.md` (decisions signed off:
1A config-flag English-only, 2A full overhaul Phases 0–4, 3A brand.config).

## Branch
- Working/integration branch: `claude/template-defects-deploy-seed-uat-0q7kb0`
  — **in sync** with origin (`@{u}..HEAD` = 0). Each unit is built on its own
  `feat/*` branch, /ship-green, pushed, then ff-merged into this branch.
- Fresh-container setup before /ship: install gitleaks v8.21.2 → ~/.local/bin +
  `export PATH="$HOME/.local/bin:$PATH"`. node_modules + generated/prisma were
  present this session (no npm ci needed). Last /ship: GREEN.

## DONE this session (all /ship green, pushed + merged to working branch)
1. **Part 1 — Arabic/RTL optional** (`feat/i18n-optional-rtl`, a8d6dc4).
   `locales`/`defaultLocale` in project.config.json → `i18n/config.ts` (single
   source: routing, `localePrefixRegex`, `localeDirection`/`directionForLocale`,
   `hasMultipleLocales`, `nextLocale`). All 6 hardcoded `(en|ar)` regexes gone.
   Switcher hides when 1 locale. ar.json inert. /code-review done.
2. **i18n stragglers** (`fix/i18n-config-contract-stragglers`, f17c96e) — from
   the Part 1 senior review: app/page.tsx + not-found href, recipe docs
   (nonce-csp, mfa), UAT files (_discover exports defaultLocale/rtl*; uiux +
   auth/guard/roles setup) all config-driven now.
3. **Phase 0 — brand.config.ts + font** (`feat/design-phase-0-brand-font`,
   12acaee). White-label single source (appName/colors/radius/density/font/
   themeColor) → antd-theme + layout + AppHeader. Inter loaded via next/font
   (verified live). no-raw-hex exempts brand.config.ts. /code-review done
   (touched eslint-rules).
4. **Phase 1 — component tokens** (`feat/design-phase-1-tokens`, c68c58d).
   Input family focus ring, Tabs/Tooltip/Dropdown/Card/Form/Tag overrides,
   per-mode neutrals. Verified live (Inter + primary render).
5. **Phase 2 — product chrome** (`feat/design-phase-2-chrome`, 80391ad).
   Branded split-screen auth (verified live, light+dark), ⌘K CommandPalette
   (+global search), NotificationsMenu (honest empty), OrgSwitcher (honest
   single-tenant), header search trigger, BrandedStatus primitive → 404/403/500/
   maintenance + branded global-error. en/ar `chrome`+`status` keys in lockstep.
   Senior review running post-push.

## In flight
- **ALL 6 BUILD UNITS DONE + pushed + merged.** Part 1 + Phases 0–4 are on the
  working branch (tip `dcaf5b0`), each /ship-green. Senior reviews: Part 1 +
  Phase 2 done (clean, nits folded in); Phase 3+4 review hit a spend limit
  (incomplete — re-run `senior-code-reviewer` on `git diff 80391ad..HEAD`).

## Deployed preview (LIVE)
- Vercel project **`it-support`** (already linked to this repo) auto-deploys
  every push. Latest preview of the full reshaped UI:
  **https://it-support-8j9ikwsjw-tariq-s-projects4.vercel.app** (commit dcaf5b0,
  READY, publicly reachable — no SSO protection).
- Verified functional via curl: `/api/health` → `{db: ok}` (Neon connected,
  migrations + seed ran), `/api/auth/csrf` live, `/en` → 307 `/en/login` (config-
  driven auth gate works on the deployed build).
- **Authenticated VISUAL design-qa is still PENDING** — blocked in this container
  (see agent-memory landmine: Playwright↔MITM-proxy + no local DB). Run from a
  direct-egress machine: `UAT_BASE_URL=<url> SEED_ADMIN_* npm run uat` →
  `/design-qa` → `/manual-uat`. Login split-screen already validated on local dev
  (light+dark); Inter loads + brand primary renders (verified live, localhost).

## Template fixes landed (so forks never hit these again)
- ✅ **gitleaks on fresh containers** (`65bd782`): session-start.sh auto-installs
  it → `~/.local/bin`; ship.mjs resolves it there regardless of PATH. Proven with
  `~/.local/bin` stripped from PATH → /ship still green. Was a per-fork `/ship`-RED.

## Remaining (operator / direct-egress session)
1. Authenticated browser design-qa of the deployed preview (dashboard, gallery
   at `/en/style-guide`, ⌘K palette, notifications, org switcher) across
   light/dark (+ RTL if a fork enables `ar`). Blocked in-container (proxy + no DB).
2. Re-run the Phase 3+4 `senior-code-reviewer` (spend-limit interrupted).
3. **Optional template improvement** (env friction, NOT a code bug): make the
   UAT/design-qa Playwright harness proxy-aware — when `HTTPS_PROXY` is set, pass
   `proxy:{server}` + `--ignore-certificate-errors` and, on `ERR_CONNECTION_CLOSED`,
   print a clear "run from a direct-egress machine" message instead of a raw stack.
   (The agent MITM proxy still blocks Chromium here, so this only improves the
   error UX + helps in less-restrictive proxies — see agent-memory landmine.)
4. Optional: land the working branch on `main` when ready (fork source-of-truth;
   verify `origin/main` is an ancestor first).

## Landmines / notes
- **Pre-existing hydration warning** (NOT mine): the CSP `nonce` on the inline
  theme script mismatches on hydration (server has nonce, client sees "") —
  baseline 4b6c1ee, Ask-before CSP/nonce path. Dev-only console noise; don't
  "fix" without the operator (middleware/lib surface).
- MCP Playwright wants chrome at /opt/google/chrome — BROKEN. Use the project's
  `playwright` with `executablePath:/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- `scaffold-entity.mjs` still seeds en+ar message files regardless of configured
  locales — logged follow-up (low; works for shipped locales).
- next/font needs a LITERAL `variable` value; layout's `variable:"--font-sans"`
  is lockstepped to brand.font.cssVar by design-tokens.test.ts.
- Don't re-fight: 13 moderate @changesets dev CVEs (SECURITY.md §13); AntD 6
  Space `orientation`; the findUnique pre-check (ADR-029 §7).
- AskUserQuestion was flaky in a prior session — decisions came pre-confirmed in
  the task, so none needed this session.
