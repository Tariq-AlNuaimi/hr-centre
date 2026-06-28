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
- **Phase 3 — branded HOCs + dashboard** (NEXT). KPI/StatCard, SectionCard,
  DataView (bulk actions + row select + column controls), DescriptionList,
  Toolbar; enrich the dashboard. Build on `components/shared/*` primitives.
- Phase 4 — component gallery (light/dark/RTL states), update
  docs/design-recipes.md, write ADR-028 extending ADR-027.

## After all phases (per task)
Re-`/deploy` a preview (seed auto-runs), then
`UAT_BASE_URL=… SEED_ADMIN_* npm run uat` → `/design-qa` → `/manual-uat`.
The authenticated chrome (palette/org/notifications/dashboard) gets its full
browser design-qa there — login split-screen already validated locally.

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
