# Recipe: Performance budget in the `/uat` flow

> `/scale-up` → perf optimization **O9**.
> Adds a **Lighthouse performance-budget** (or a cheaper bundle-size) assertion to
> the Playwright `/uat` run, so a regression that tanks load time or balloons the
> JS bundle **fails the run** instead of shipping silently.

## When to add it

Add this when **performance is a thing the team cares about and could regress**:

- A stakeholder has complained the app "feels slow," or you've just done O1
  (RSC list reads) / O4 (trigram search) and want a guard so a future change
  doesn't undo the win.
- The app is heading toward `/handoff` and you want a documented perf baseline the
  IT team inherits.

**Keep it opt-in.** Lighthouse pulls in a heavy dependency tree (`lighthouse` +
`chrome-launcher`); per the lean-base principle (ADR-014) it does **not** belong in
the base `package.json`. Add it only to a fork that needs it. If you only want to
catch *bundle* regressions (the most common cause of slowdowns) the **bundle-size
assertion (Option B)** needs **no new dependency at all** — prefer it unless you
specifically need real Lighthouse field metrics.

## How `/uat` works today (what we extend)

`/uat` drives Chromium via Playwright. Specs live in `tests/uat/` as `*.uat.ts`
(plus `auth.setup.ts`); `playwright.config.ts` sets the chromium project's
`testMatch: /\.uat\.ts$/`. We add **one more spec** — a perf budget — to that set.
It runs with the same `npm run uat`; nothing about the existing smoke / guard specs
changes.

---

## Option A — Lighthouse budget (real Web Vitals, heavy dep)

### Deps

```bash
npm install -D playwright-lighthouse lighthouse chrome-launcher
```

> All three are **devDependencies** — they never ship to the client or the Vercel
> runtime. They're added to a fork, not the template base (ADR-014).

### The budget spec — `tests/uat/perf-budget.uat.ts`

```ts
import { test } from "@playwright/test";
import { playAudit } from "playwright-lighthouse";
import { chromium } from "playwright";

// Opt-in: only runs when PERF_BUDGET=1, so the default `/uat` run stays fast and
// dep-light for forks that didn't install the Lighthouse deps.
const enabled = process.env.PERF_BUDGET === "1";

// Lighthouse needs a dedicated debugging port; reuse one Chromium for the file.
const PORT = 9222;

test.describe(enabled ? "perf budget" : "perf budget (skipped)", () => {
  test.skip(!enabled, "set PERF_BUDGET=1 (and install Lighthouse deps) to enable");

  // Pages to audit. Use the deployed UAT_BASE_URL when set; else local dev.
  const base = process.env.UAT_BASE_URL ?? "http://localhost:3000";
  const paths = ["/en", "/en/users"]; // extend per fork

  for (const path of paths) {
    test(`budget: ${path}`, async () => {
      const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
      const page = await browser.newPage();
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });

      await playAudit({
        page,
        port: PORT,
        // Fail the test if any category drops below its floor (0–100).
        thresholds: {
          performance: 80,
          accessibility: 90,
          "best-practices": 90,
          seo: 80,
        },
        // Optional: hard byte/timing budgets — fails if exceeded.
        // budgetPath: "tests/uat/lighthouse-budget.json",
        reports: {
          formats: { html: true },
          name: `lighthouse-${path.replace(/\W+/g, "_")}`,
          directory: "tests/uat/.lighthouse",
        },
      });

      await browser.close();
    });
  }
});
```

Optional resource budget file (`tests/uat/lighthouse-budget.json`) for hard byte
limits in addition to the category scores:

```json
[
  {
    "path": "/*",
    "resourceSizes": [
      { "resourceType": "script", "budget": 350 },
      { "resourceType": "total", "budget": 1600 }
    ],
    "timings": [
      { "metric": "interactive", "budget": 3500 },
      { "metric": "largest-contentful-paint", "budget": 2500 }
    ]
  }
]
```

(`budget` is in **KB** for `resourceSizes`, **ms** for `timings`.)

### Running it

```bash
# Against the deployed preview/prod URL (preferred — real CDN, real cold paths):
PERF_BUDGET=1 UAT_BASE_URL=https://<slug>.vercel.app npm run uat

# Against local dev (playwright.config starts the dev server automatically):
PERF_BUDGET=1 npm run uat
```

A category below its threshold (or a budget exceeded) **fails the Playwright run**,
so it shows up exactly like a failed smoke step. The HTML reports land in
`tests/uat/.lighthouse/` — add that dir to `.gitignore`.

> **Caveat:** Lighthouse scores are noisy, especially against a cold serverless
> deployment or a busy local machine. Set thresholds with headroom (e.g. 80, not
> 95) and treat a *single* dip as a re-run candidate, not an instant red. Audit a
> **deployed** URL for stable numbers; local dev includes HMR/dev overhead and will
> score lower. This is a regression tripwire, not a benchmark of record.

---

## Option B — Bundle-size assertion (no new dependency)

If you only want to catch "someone imported a 400 KB chart lib into a client
component" without the Lighthouse weight, assert on the **built bundle** instead.
`next build` already writes per-route JS sizes; the simplest durable check is a
total-First-Load-JS ceiling.

### The spec — `tests/uat/bundle-size.uat.ts`

```ts
import { test, expect } from "@playwright/test";

// Opt-in like Option A. This one needs NO extra dependency — it just inspects the
// JS the page actually downloads in the real browser Playwright already drives.
const enabled = process.env.PERF_BUDGET === "1";

// Max total transferred JS per page, in KB. Tune to your baseline + headroom.
const MAX_JS_KB = 400;

test.describe(enabled ? "bundle budget" : "bundle budget (skipped)", () => {
  test.skip(!enabled, "set PERF_BUDGET=1 to enable");

  const base = process.env.UAT_BASE_URL ?? "http://localhost:3000";

  for (const path of ["/en", "/en/users"]) {
    test(`js budget: ${path}`, async ({ page }) => {
      let jsBytes = 0;
      page.on("response", (res) => {
        const type = res.request().resourceType();
        if (type === "script") {
          const len = Number(res.headers()["content-length"] ?? 0);
          jsBytes += len;
        }
      });
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      const kb = Math.round(jsBytes / 1024);
      console.log(`[bundle] ${path}: ${kb} KB JS`);
      expect(kb, `${path} shipped ${kb} KB JS (budget ${MAX_JS_KB} KB)`).toBeLessThanOrEqual(
        MAX_JS_KB
      );
    });
  }
});
```

> `content-length` is missing on some chunked/compressed responses; for a stricter
> count, sum `(await res.body()).length`. Run against a **production build**
> (`UAT_BASE_URL` pointed at a Vercel deploy, or `npm run build && npm start`
> locally) — dev-mode JS is unminified and will dwarf the budget. The base already
> ships `npm run analyze` (`next.config.ts`'s bundle-analyzer, `ANALYZE=true`) for
> the interactive treemap when a budget trips and you need to see *what* grew.

---

## Files to change in a fork

| File | Change |
|---|---|
| `tests/uat/perf-budget.uat.ts` **or** `tests/uat/bundle-size.uat.ts` | **New** — the budget spec |
| `tests/uat/lighthouse-budget.json` | **New** — optional (Option A hard budgets) |
| `package.json` | Option A only: add `playwright-lighthouse` + `lighthouse` + `chrome-launcher` as **devDependencies** |
| `.gitignore` | add `tests/uat/.lighthouse/` (Option A reports) |

The spec auto-joins the existing chromium `testMatch: /\.uat\.ts$/`, so no
`playwright.config.ts` change is needed. It's gated behind `PERF_BUDGET=1` so a
fork that didn't install the deps (or doesn't want the check) runs `/uat` exactly
as before.

## How to test

1. `PERF_BUDGET=1 npm run uat` against a deployed URL → the budget spec runs and
   passes at your baseline.
2. Temporarily lower a threshold (`performance: 99`) or `MAX_JS_KB` to a tiny value
   → the run **fails** with the offending page/metric. Restore it.
3. Without `PERF_BUDGET=1`, `npm run uat` runs the normal smoke/guard specs and the
   budget spec is **skipped** (proves it's opt-in).
4. `/ship` (the perf spec is excluded from the unit runner — it matches `*.uat.ts`,
   not `*.test.ts` — so it doesn't affect `npm test`).

## Rollback

Delete the budget spec (and `lighthouse-budget.json`). For Option A, also remove
the three devDependencies from `package.json` and `npm install`. Nothing else
referenced them; `/uat` returns to smoke/guard only.
