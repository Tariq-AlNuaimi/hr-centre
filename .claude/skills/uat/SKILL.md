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

Every run produces **both** a navigable **HTML report** (`uat-report/`, open with
`npm run uat:report`) **and a single PDF** (`uat-report/uat-report.pdf`, via
`npm run uat:pdf`) — the PDF is the shareable, archivable artifact.

## Two modes — ASK on every run

`/uat` has two modes, selected by the `UAT_MODE` env flag:

| Mode | Command | What runs | When |
|---|---|---|---|
| **Lean** (default) | `npm run uat` (`UAT_MODE=lean`) | route-discovered smoke + the auth guard | the everyday "does it still load" pass before sharing |
| **Full** | `npm run uat:full` (`UAT_MODE=full`) | everything lean runs **plus** the `*.full.uat.ts` deep-audit phases, with video recorded for every test | a thorough audit before a milestone / handoff / external share |

> **Standing instruction — ASK every time.** On every `/uat` invocation, **ask the
> operator "Lean or Full?" through the question UI** before running anything. **Lean
> is the default** — if they don't care, run lean. Only run Full when they pick it
> (it's slower and, for P6, may want web access). Never silently pick Full.

The split is enforced in `playwright.config.ts`: the chromium project matches
`*.uat.ts`, and **lean `testIgnore`s `*.full.uat.ts`** so the Full-only phases never
run in lean. Full mode also flips video from `retain-on-failure` to `on`.

## The 7 Full phases

Full mode is a phased deep audit. **Today only P1 runs** (plus the lean smoke +
guard, which Full always includes); **P2–P7 are delivered incrementally across
Builds B–E** and are documented here so the shape is fixed:

| Phase | Name | What it does | Status |
|---|---|---|---|
| **P1** | Discover | Scan `app/[locale]/(dashboard)/**/page.tsx` (+ the Prisma schema) to enumerate every screen/entity; this drives the smoke breadth pass. | **Delivered (this build)** — `tests/uat/_discover.ts` + `smoke.uat.ts` |
| **P2** | Permission matrix | Log in as each `Role`; assert each role reaches its allowed screens and is blocked from the rest. | Build B |
| **P3** | CRUD journeys | One data-writing journey per scaffolded entity: create → confirm in list → edit → (soft-)delete/restore. Covers the dynamic + `new` routes P1 skips. | Build C |
| **P4** | UI/UX sweep | Per-screen UI checks: empty states, loading, broken links, form validation, RTL (`ar`), dark mode, console errors. | Build C |
| **P5** | Logic + UX recommendations | Synthesize findings into a prioritized P0/P1/P2 recommendation list (wired/partial/stubbed inventory with `file:line` evidence). | Build D |
| **P6** | Peer + enterprise benchmark | **Needs web search.** Compare the app against enterprise norms + 3–5 peer products for its domain. **Skips gracefully if web access is unavailable** (notes the skip in the report rather than failing). | Build E |
| **P7** | PDF report | Assemble P1–P6 into `uat-report/uat-report.pdf`. | **Assembler delivered (this build)** — `scripts/uat-pdf.mjs`; P2–P6 sections slot in at marked `TODO(P#)` anchors |

Each future phase ships as `*.full.uat.ts` specs (lean ignores them) and injects a
report section at the corresponding `TODO(P#)` anchor in `scripts/uat-pdf.mjs`.

## Discovery-driven generality

This skill is **app-agnostic**. It does not hardcode screen names — it derives them
from the app itself, so it works for any fork without edits:

- **Routes** — `tests/uat/_discover.ts` `discoverScreens()` scans the dashboard
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
- `_discover.ts` — `discoverScreens()`, the runtime route scanner (P1).
- `smoke.uat.ts` — route-discovered authenticated walkthrough; per screen asserts
  status < 400 + not bounced to `/login`, and attaches a full-page screenshot.
- `guard.uat.ts` — unauthenticated visitors are bounced to login.

**Added by future Full builds** (as `*.full.uat.ts`, ignored by lean):
- a per-role `auth.setup.ts` (one storage state per role from `UAT_<ROLE>_*` env vars).
- `roles.full.uat.ts` — P2 permission matrix.
- `<entity>.full.uat.ts` journeys — P3 CRUD flows, one per key entity.
- `scripts/uat-cleanup.ts` + an `uat:cleanup` npm script — only if a flow creates
  records with no UI delete path.

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

6. **Build the PDF.** After the run, `npm run uat:pdf` reads
   `uat-results/results.json` + the attached screenshots and writes
   `uat-report/uat-report.pdf`. It degrades gracefully when there are no results yet.

7. **Report.** Summarize pass/fail per flow with the screenshot for each. Point to
   **both** the HTML report (`npm run uat:report`) and the PDF
   (`uat-report/uat-report.pdf`). For failures, include the step and the screenshot
   so the fix is targeted. For Full, also surface the P2–P6 sections (as those
   builds land).

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
