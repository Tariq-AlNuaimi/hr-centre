# Session handoff

> New session: the enterprise design overhaul + optional i18n task is COMPLETE
> and landed on `main`. This is a wrap-up, not in-flight work. Read it, then the
> only remaining items are operator-side QA (see "Next steps").

## Goal
Make the template look enterprise/sellable (operator: UI "looks amateur") and
make Arabic/RTL optional. DONE — Part 1 + design Phases 0–4, all on AntD
(ADR-027/028). Plus two harness fixes from friction hit this session.

## State
- Branch: `main` — **in sync** with origin (`@{u}..HEAD` = 0), clean tree. The
  working branch `claude/template-defects-deploy-seed-uat-0q7kb0` is the SAME
  commit (ff-merged). Tip: `800c376`.
- Last `/ship`: GREEN. Deployed: Vercel `it-support` project auto-deploys; live
  preview of the full UI: https://it-support-8j9ikwsjw-tariq-s-projects4.vercel.app
  (curl-verified: /api/health → db ok, auth gate works).

## Done (landed on main this session)
- Part 1 i18n-optional (a8d6dc4) + stragglers (f17c96e); design Phase 0 brand+font
  (12acaee), Phase 1 tokens (c68c58d), Phase 2 chrome (80391ad), Phase 3 HOCs
  (6bc846e), Phase 4 gallery+docs+ADR-028 (dcaf5b0).
- fix(harness): gitleaks auto-install on fresh containers (65bd782) — was a
  per-fork /ship-RED; verified fixed.
- fix(uat): proxy-aware Playwright for remote UAT_BASE_URL (800c376).
- Senior reviews: Part 1 + Phase 2 clean (nits folded). Phase 3+4 review hit a
  spend limit (incomplete).

## In flight
None — task shipped + merged to main.

## Decisions
- i18n: config flag, default English-only (1A). Design: full overhaul Phases 0–4
  (2A). White-label: one brand.config per client (3A). Stay on AntD (ADR-027/028).

## Landmines (durable ones also in docs/agent-memory.md)
- **In-container browser QA is blocked**: the agent MITM proxy rejects Chromium
  (ERR_CONNECTION_CLOSED; curl works) AND no local DB (no docker). Credentials
  are NOT the blocker — the network is. Authenticated VISUAL QA must run from a
  direct-egress machine or after loosening the env network policy.
- Pre-existing CSP-nonce hydration warning (baseline 4b6c1ee, Ask-before path) —
  not the design work; don't "fix" without the operator.

## Next steps (operator-side; pick one to see the authenticated UI)
1. Open the live URL above in a browser, log in with the Vercel `it-support`
   SEED_ADMIN_* creds → manual UAT of dashboard, `/en/style-guide` gallery, ⌘K
   palette, notifications, org switcher (toggle light/dark).
2. Or from a direct-internet machine: `UAT_BASE_URL=<url> SEED_ADMIN_EMAIL=…
   SEED_ADMIN_PASSWORD=… npm run uat` (add `UAT_MODE=full`) → `/design-qa`.
3. Re-run the Phase 3+4 `senior-code-reviewer` on `git diff 80391ad..dcaf5b0`.
