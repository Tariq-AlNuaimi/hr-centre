---
name: uat
description: Browser-driven User Acceptance Testing with two modes -- LEAN (fast smoke: every screen loads, screenshot each) and FULL (a phased deep audit: permission matrix, per-entity CRUD journeys, UI/UX sweep, logic+UX recommendations, peer+enterprise benchmark, and a PDF report). On every /uat, ASK the operator "Lean or Full?" (lean is the default). Runs against a deployed URL (preferred) or local dev; can also run online via the dormant uat.yml workflow. Produces BOTH an HTML report and a PDF. The solo-dev replacement for clicking through the app by hand before sharing it. Trigger phrases: "uat", "acceptance test", "click through the app", "walk the flows", "/uat", "test it in the browser", "screenshot the app", "what features are missing", "benchmark the app", "full uat", "deep audit".
---

# /uat — User Acceptance Testing through Chrome

The solo-dev version of "click through the app before I share it." Drives a real
Chromium browser (via Playwright) through the app's flows, screenshots each step,
and reports what passed. The screenshots double as the artifact you send
stakeholders. See ADR-008.

`/uat` **runs and reports**. It does not change app code. If a flow fails, it
shows you the screenshot + step so you (or a follow-up edit) can fix it.

> **Tier 3 of the QA system** (`docs/uat-rubric.md`). UAT validates **acceptance** —
> *does it meet the business need?* — judged by the **operator** against acceptance
> criteria, with a **traceability matrix** (every requirement → ≥1 scenario → pass/fail).
> It runs **after** design QA (`/design-qa`) and functional QA (`/ship`) have passed (the
> `/qa` orchestrator enforces that order). UAT is **not** a second bug-hunt — the agent
> produces the evidence pack; the operator signs off.

Every run produces **both** a navigable **HTML report** (`uat-report/`, open with
`npm run uat:report`) **and a single PDF** (`uat-report/uat-report.pdf`, via
`npm run uat:pdf`) — the PDF is the shareable, archivable artifact.

## Two modes — ASK on every run

`/uat` has two modes, selected by the `UAT_MODE` env flag:

| Mode | Command | What runs | When |
|---|---|---|---|
| **Lean** (default) | `npm run uat` (`UAT_MODE=lean`) | the **MAIN sections only** (top-level nav, depth ≤ 1) — discovered, not hardcoded — each loads + screenshot, + the auth guard | the everyday "does it still load" pass before sharing |
| **Full** | `npm run uat:full` (`UAT_MODE=full`) | the **full journey** — every screen + sub-page + every button + per-entity CRUD + the per-role matrix (the `*.full.uat.ts` phases), all discovered; video recorded for every test | a thorough audit before a milestone / handoff / external share |

> **Both modes are fully discovery-driven — NEVER hardcode an app's screens,
> entities, roles, or buttons.** Lean derives the *main sections*
> (`discoverMainSections()` — depth ≤ 1); Full derives the *whole surface*
> (`discoverAllScreens()` + the Prisma schema for entities/roles + a DOM crawl for
> buttons). This is what lets the same skill audit *any* app the template produces,
> however far the builds diverge.

> **Standing instruction — ASK every time.** On every `/uat` invocation, **ask the
> operator "Lean or Full?" through the question UI** before running anything. **Lean
> is the default** — if they don't care, run lean. Only run Full when they pick it
> (it's slower and, for P6, may want web access). Never silently pick Full.

The split is enforced in `playwright.config.ts`: the chromium project matches
`*.uat.ts`, and **lean `testIgnore`s `*.full.uat.ts`** so the Full-only phases never
run in lean. Full mode also flips video from `retain-on-failure` to `on`.

## The 7 Full phases

Full mode is a phased deep audit. **All seven phases are delivered** (lean always
runs the smoke + guard; the rest are full-only):

| Phase | Name | What it does | Status |
|---|---|---|---|
| **P1** | Discover | Scan `app/[locale]/(dashboard)/**/page.tsx` (+ the Prisma schema) to enumerate every screen/entity; this drives the smoke breadth pass. | **Delivered** — `tests/uat/_discover.ts` + `smoke.uat.ts` |
| **P2** | Permission matrix | Log in as each `Role`; assert each role reaches its allowed screens and is blocked from the rest. | **Delivered (Build B)** — `roles.setup.ts` + `roles.full.uat.ts` |
| **P3** | CRUD journeys | One data-writing journey per scaffolded entity: create → confirm in list → edit → (soft-)delete. Covers the dynamic + `new` routes P1 skips; captures console/runtime errors on the forms the sweep doesn't visit. | **Delivered (Build C)** — `crud.full.uat.ts` |
| **P4** | UI/UX sweep | Per-section checks: visible heading (not a blank shell), no uncaught runtime errors, RTL (`ar`) flips `dir="rtl"`, console-error tally. | **Delivered (Build C)** — `uiux.full.uat.ts` |
| **P5** | Logic + UX recommendations | Synthesize the run's outcomes (failing flows, authz mismatches, runtime/console errors) + a static stub-marker scan into a prioritized P0/P1/P2 list with `file:line` evidence. | **Delivered (Build D)** — `scripts/uat-recommend.mjs` |
| **P6** | Peer + enterprise benchmark | **Needs web search.** Compare the app against enterprise norms + 3–5 peer products for its domain (the agent runs the searches and writes `uat-results/benchmark.json`). **Skips gracefully if web access is unavailable** (notes the skip in the report rather than failing). | **Delivered (Build E)** — `scripts/uat-benchmark.mjs` (loader/validator) + PDF renderer |
| **P7** | PDF report | Assemble P1–P6 into `uat-report/uat-report.pdf` (+ a self-contained `uat-report.html` twin). | **Delivered** — `scripts/uat-pdf.mjs` |

Each future phase ships as `*.full.uat.ts` specs (lean ignores them) and injects a
report section at the corresponding `TODO(P#)` anchor in `scripts/uat-pdf.mjs`.

## Discovery-driven generality

This skill is **app-agnostic**. It does not hardcode screen names — it derives them
from the app itself, so it works for any fork without edits:

- **Routes** — `tests/uat/_discover.ts` `discoverMainSections()` (lean) / `discoverAllScreens()` (full) scans the dashboard
  route tree at runtime (node `fs`), mapping each `page.tsx` to a URL
  (`users` → `/en/users`, the group root → `/en`, nested like `settings/profile`).
  It **skips** dynamic segments (`[id]`, `[...all]`), `new` create-forms, and route
  groups (`(auth)`, `(dashboard)`). `smoke.uat.ts` iterates that list, so scaffolding
  a new entity auto-adds it to the smoke pass with zero edits.
- **Schema** — Full phases (P2/P3) read the `Role` enum and the Prisma models to
  build the permission matrix and per-entity CRUD journeys.

**Foreign-app DOM-crawl fallback.** When the target is a foreign app (no
template route tree on disk — e.g. a deployed URL with no matching local repo),
P1 falls back to **crawling the rendered DOM**: log in, read the nav/sidebar links,
and treat each reachable in-app link as a screen. Routes-first when the source is
present; DOM-crawl when it isn't.

## Backbone — what ships in `tests/uat/`

Driven by `playwright.config.ts`:
- `auth.setup.ts` — logs in once from `UAT_EMAIL`/`UAT_PASSWORD` (or the seeded
  `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`) and saves one storage state.
- `_discover.ts` — `discoverMainSections()` (lean) / `discoverAllScreens()` (full), the runtime route scanner (P1).
- `smoke.uat.ts` — route-discovered authenticated walkthrough; per screen asserts
  status < 400 + not bounced to `/login`, and attaches a full-page screenshot.
- `guard.uat.ts` — unauthenticated visitors are bounced to login.

**Full-mode specs** (as `*.full.uat.ts`, ignored by lean):
- `roles.setup.ts` — per-role auth setup (one storage state per role, env creds).
- `roles.full.uat.ts` — P2 permission matrix.
- `crud.full.uat.ts` — P3 CRUD journeys, one per discovered entity (create →
  confirm → edit → soft-delete), generic form-filler, console/runtime-error capture.
- `uiux.full.uat.ts` — P4 per-section UI/UX sweep (heading, runtime errors, RTL).

Each writes a JSON sink under `uat-results/` (`role-matrix.json`,
`crud-journeys.json`, `uiux-findings.json`) that `scripts/uat-pdf.mjs` renders
into the report. The sinks are reset at the start of every full run by
`roles.setup.ts`.

> Spec files are `*.uat.ts` + `auth.setup.ts`; the chromium project sets
> `testMatch: /\.uat\.ts$/` so they run AND so the unit runner (which matches
> `*.test.ts`) never collects them. Full-only specs are `*.full.uat.ts`.

## Steps

1. **Ask "Lean or Full?"** via the question UI. Lean is the default. (See the
   standing instruction above — never skip this, never silently pick Full.)

2. **Pick the target (URL-first, local fallback).**
   - Ask the operator for a URL, or use `UAT_BASE_URL`. Preferred: a Vercel
     preview / prod URL (matches the share-via-URL workflow).
   - If none given, default to `http://localhost:3000`; the config auto-starts
     `npm run dev` (needs a running DB + seeded admin).

3. **Check the browser is installed.** If the run reports the Chromium binary is
   missing, tell the operator to run `npm run uat:install` once on this machine.
   **Do NOT report a pass when the browser could not launch** — that's a "could not
   run," not a green.

4. **Check credentials — env only.** The shipped `auth.setup.ts` logs in from
   `UAT_EMAIL`/`UAT_PASSWORD`, falling back to `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.
   Never hardcode. If the login is unset, the setup step fails with a clear message —
   surface it. (For Full multi-role coverage, add per-role `UAT_<ROLE>_*` vars.)

5. **Run.**
   - Lean: `npm run uat` (headless) / `npm run uat:headed` (watch it).
   - Full: `npm run uat:full`.
   - With a deployed target:
     `UAT_BASE_URL="https://<app>.vercel.app" UAT_EMAIL=... UAT_PASSWORD=... npm run uat`.

6. **(Full only) P6 benchmark — run the web searches.** Full mode's benchmark is
   produced by **you (the agent)**, not a Node script. Infer the app's **domain**
   from the discovered entities + Prisma schema, then **web-search** enterprise
   norms for that domain + 3–5 peer products, and write the findings to
   `uat-results/benchmark.json` (run `npm run uat:benchmark -- --schema` for the
   exact shape; `-- --check` validates it). Ground each `appStatus` in real
   evidence from the codebase. **If web access is unavailable, skip this** — the
   report notes the skip; it never fails the run.

7. **Build the PDF.** After the run, `npm run uat:pdf` reads
   `uat-results/results.json` + the attached screenshots and writes
   `uat-report/uat-report.pdf` **and** a self-contained `uat-report.html` twin. It
   auto-runs the P5 synthesizer (`npm run uat:recommend`, also runnable standalone)
   so the report always carries fresh prioritized recommendations, and renders the
   P6 benchmark (or its skip note) in full mode. It degrades gracefully when there
   are no results yet.

8. **Report.** Summarize pass/fail per flow with the screenshot for each. Point to
   **both** the HTML report (`npm run uat:report`) and the PDF
   (`uat-report/uat-report.pdf`). For failures, include the step and the screenshot
   so the fix is targeted. For Full, also surface the P2–P6 sections (matrix, CRUD
   journeys, UI/UX sweep, recommendations, benchmark).

## Run it online (no terminal) — `uat.yml`

`.github/workflows/uat.yml` ships **dormant** (free-plan Actions are blocked). Once
Actions is enabled (paid plan or a public repo), run it from the **GitHub website**:
Actions tab → **UAT** → **Run workflow** — from any machine, no terminal. Creds come
from repo **secrets**; the screenshot report (and PDF) upload as a downloadable
artifact on the run page. Optional `schedule:` block for nightly runs.

## Optional: explore live

For ad-hoc "walk through this with me now" (no committed test), the operator can
wire the **Playwright MCP** server and drive the browser interactively. Use that
for exploration; keep `tests/uat/` as the repeatable backbone.

## Boundaries

- UAT exercises a **running app's flows** — it is **not** a security pentest.
  Code/dependency scanning is `/audit` + `/ship`; live-app security scanning is the
  planned `/vapt` (OWASP ZAP) follow-up.
- Do **not** hardcode credentials or secrets in specs — env only.
- Do **not** commit `uat-results/` / `uat-report/` (gitignored; they hold sessions,
  screenshots, videos, and the PDF).
- Tag created data with a stable `UAT —` prefix and clean it up (UI/recycling-bin or
  a scoped `uat:cleanup`); point cleanup at the **test** DB, never production.
- Do **not** call a run green if the browser/credentials could not be set up — say
  "could not run" and how to fix it.
- P6 (benchmark) **requires web access** — if unavailable, it skips and the report
  notes the skip; it does not fail the run.
