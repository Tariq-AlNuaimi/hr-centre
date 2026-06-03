---
name: uat
description: Browser-driven User Acceptance Testing -- walk the app's key flows in Chromium (Playwright), screenshot each step, report pass/fail, and (on request) produce a feature-gap + benchmark report. Runs against a deployed URL (preferred) or local dev; can also run online via the dormant uat.yml workflow. The solo-dev replacement for clicking through the app by hand before sharing it. Trigger phrases: "uat", "acceptance test", "click through the app", "walk the flows", "/uat", "test it in the browser", "screenshot the app", "what features are missing", "benchmark the app".
---

# /uat — User Acceptance Testing through Chrome

The solo-dev version of "click through the app before I share it." Drives a real
Chromium browser (via Playwright) through the app's key flows, screenshots each
step, and reports what passed. The screenshots double as the artifact you send
stakeholders. See ADR-008.

`/uat` **runs and reports**. It does not change app code. If a flow fails, it
shows you the screenshot + step so you (or a follow-up edit) can fix it.

## Backbone

**What ships** in `tests/uat/` today (driven by `playwright.config.ts`):
- `auth.setup.ts` — logs in once from `UAT_EMAIL`/`UAT_PASSWORD` (or the seeded
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`) and saves one storage state.
- `smoke.uat.ts` — authenticated walkthrough of the shipped screens, with screenshots.
- `guard.uat.ts` — unauthenticated visitors are bounced to login.

**Add these as the app grows** (they are NOT in the template — create them when you
need multi-role / data-writing coverage):
- `helpers.ts` — `UAT_PREFIX` tagging, `uatName()`, per-role credential lookup.
- a per-role `auth.setup.ts` (one storage state per role from `UAT_<ROLE>_*` env vars).
- `roles.uat.ts` — permission matrix: each role reaches what it should, is blocked from what it shouldn't.
- `*.uat.ts` journeys — data-writing flows (create → verify → edit), one per key entity.
- `scripts/uat-cleanup.ts` + an `uat:cleanup` npm script — only if a flow creates records with no UI delete path.

> Spec files are `*.uat.ts` + `auth.setup.ts`; the chromium project sets
> `testMatch: /\.uat\.ts$/` so they run AND so the unit runner (which matches
> `*.test.ts`) never collects them.

## Coverage tiers — grow these per project

1. **Smoke** — every shipped screen loads for an admin (status < 400, not bounced to login), screenshot each. The breadth pass.
2. **Permission matrix** — log in as each role; assert admin-only screens redirect non-admins; assert each role reaches its allowed screens.
3. **Data-writing journeys** — the real flows: create an entity → confirm it in the list → edit it → (soft-)delete/restore. Add one per scaffolded entity.

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

3. **Check credentials — env only.** The shipped `auth.setup.ts` logs in from
   `UAT_EMAIL`/`UAT_PASSWORD`, falling back to `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.
   Never hardcode. If the login is unset, the setup step fails with a clear message —
   surface it. (For multi-role coverage, add per-role `UAT_<ROLE>_*` vars + a per-role
   setup as described in the Backbone "add these" list.)

4. **Fit the flows to the app.** Inventory the app's routes
   (`app/[locale]/(dashboard)/**/page.tsx`), the `Role` enum, and the scaffolded
   entities. Add any missing screens to `smoke.uat.ts`; add data-writing journeys and a
   role matrix as you grow them. Keep selectors locale-independent (ids / `getByRole`)
   since the app ships `en` + `ar`.

5. **Tag everything you create, and clean up.** Stamp created records with a stable
   `UAT —` prefix so test data is identifiable.
   - Prefer the app's own delete / **recycling-bin** (soft-delete) to clean up in-UI.
   - For records with no delete path, add a `scripts/uat-cleanup.ts` (dry-run by
     default; `--confirm` to delete; strictly scoped to the `UAT —` prefix; children
     before parents) and an `uat:cleanup` script. Point `DATABASE_URL` at the **test** DB.

6. **Run.** `npm run uat` (headless) or `npm run uat:headed` to watch it. With a
   deployed target:
   `UAT_BASE_URL="https://<app>.vercel.app" UAT_ADMIN_EMAIL=... UAT_ADMIN_PASSWORD=... npm run uat`.

7. **Report.** Summarize pass/fail per flow with the screenshot for each, and
   point to the HTML report (`npm run uat:report`). For failures, include the
   step and the screenshot so the fix is targeted.

## Run it online (no terminal) — `uat.yml`

`.github/workflows/uat.yml` ships **dormant** (free-plan Actions are blocked). Once
Actions is enabled (paid plan or a public repo), run it from the **GitHub website**:
Actions tab → **UAT** → **Run workflow** — from any machine, no terminal. Creds come
from repo **secrets**; the screenshot report uploads as a downloadable artifact on the
run page. Optional `schedule:` block for nightly runs.

## Feature-gap + benchmark report (on request)

When the operator asks "what's missing" / "benchmark this app", produce
`docs/UAT-FINDINGS-AND-FEATURE-GAP.md`:
- **Feature-status inventory** — every screen's actions classified WIRED / PARTIAL / STUBBED, with `file:line` evidence.
- **Role / permission map** — the roles and what each gates.
- **Enterprise benchmark** — compare against enterprise norms for this app's domain (e.g. for a CLM: SSO/SAML, RBAC depth, audit, retention/purge, e-signature, OCR, API). Web-search the domain's leaders.
- **Peer benchmark** — 3–5 comparable products: what they do better, what this app matches/beats.
- **Prioritized recommendations** — P0/P1/P2 roadmap.
This pairs the dynamic findings (what the live run surfaced) with a static audit.

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
- Tag created data with `UAT_PREFIX` and clean it up (UI/recycling-bin or `uat:cleanup`);
  point cleanup at the **test** DB, never production.
- Do **not** call a run green if the browser/credentials could not be set up — say
  "could not run" and how to fix it.
