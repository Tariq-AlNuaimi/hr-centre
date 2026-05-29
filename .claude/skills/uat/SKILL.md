---
name: uat
description: Browser-driven User Acceptance Testing -- walk the app's key flows in Chromium (Playwright), screenshot each step, report pass/fail. Runs against a deployed URL (preferred) or local dev. The solo-dev replacement for clicking through the app by hand before sharing it. Trigger phrases: "uat", "acceptance test", "click through the app", "walk the flows", "/uat", "test it in the browser", "screenshot the app".
---

# /uat — User Acceptance Testing through Chrome

The solo-dev version of "click through the app before I share it." Drives a real
Chromium browser (via Playwright) through the app's key flows, screenshots each
step, and reports what passed. The screenshots double as the artifact you send
stakeholders. See ADR-008.

`/uat` **runs and reports**. It does not change app code. If a flow fails, it
shows you the screenshot + step so you (or a follow-up edit) can fix it.

## Backbone

Committed Playwright specs in `tests/uat/`, driven by `playwright.config.ts`:
- `auth.setup.ts` — logs in once (env creds), saves the session.
- `smoke.uat.ts` — authenticated walkthrough of each screen, with screenshots.
- `guard.uat.ts` — unauthenticated visitors are bounced to login.

## Steps

1. **Pick the target (URL-first, local fallback).**
   - Ask the operator for a URL, or use `UAT_BASE_URL`. Preferred: a Vercel
     preview / prod URL (matches the share-via-URL workflow).
   - If none given, default to `http://localhost:3000`; the config auto-starts
     `npm run dev` (needs a running DB + seeded admin).

2. **Check the browser is installed.** If `npm run uat` reports the Chromium
   binary is missing, tell the operator to run `npm run uat:install` once on this
   machine. **Do NOT report a pass when the browser could not launch** — that's a
   "could not run," not a green.

3. **Check credentials.** UAT logs in using `UAT_EMAIL`/`UAT_PASSWORD` (preferred)
   or `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Never hardcode them. If unset,
   the setup step fails with a clear message — surface it.

4. **Fit the flows to the app.** Inventory the app's routes
   (`app/[locale]/(dashboard)/**/page.tsx`) and the scaffolded entities. If the
   project has screens not in `smoke.uat.ts`, add them (or propose richer
   click-flows: create an entity, edit it, soft-delete it, restore it from the
   recycling bin). Keep selectors locale-independent (ids / `getByRole`), since
   the app ships `en` + `ar`.

5. **Run.** `npm run uat` (headless) or `npm run uat:headed` to watch it. With a
   deployed target:
   `UAT_BASE_URL="https://<app>.vercel.app" UAT_EMAIL=... UAT_PASSWORD=... npm run uat`.

6. **Report.** Summarize pass/fail per flow with the screenshot for each, and
   point to the HTML report (`npm run uat:report`). For failures, include the
   step and the screenshot so the fix is targeted.

## Optional: explore live

For ad-hoc "walk through this with me now" (no committed test), the operator can
wire the **Playwright MCP** server and drive the browser interactively. Use that
for exploration; keep `tests/uat/` as the repeatable backbone.

## Boundaries

- UAT exercises a **running app's flows** — it is **not** a security pentest.
  Code/dependency scanning is `/audit` + `/ship`; live-app security scanning is the
  planned `/vapt` (OWASP ZAP) follow-up.
- Do **not** hardcode credentials or secrets in specs — env only.
- Do **not** commit `uat-results/` / `uat-report/` (gitignored; they hold sessions
  + screenshots).
- Do **not** call a run green if the browser/credentials could not be set up — say
  "could not run" and how to fix it.
