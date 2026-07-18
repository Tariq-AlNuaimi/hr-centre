import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { defaultLocale } from "./_discover";
import { brand } from "../../brand.config";
import { chartPalette } from "../../components/shared/chart-palette";

// Design-system PARITY gate (fix-list "Playwright gate"). The static/source
// invariants run browser-free in the warm `/ship` contract phase
// (tests/contracts/design-system-drift.test.ts); THIS spec is the browser tier
// (runs under `npm run uat` / `/qa`, where a live authed app exists) and proves
// the things only a real render can:
//   - the route mounts clean (no console errors, no login bounce);
//   - every value shown as text is the SAME value the token source holds
//     (computed, not hand-typed — fix-list P1.5);
//   - interactions are live, not inert: hovering the primary action changes its
//     paint, and toggling [data-theme] flips the dark surface swap (P0.2);
//   - axe is clean of serious/critical in BOTH themes (P3.10);
//   - the rendered screen matches a committed baseline within 1.5% (visual drift).

const L = defaultLocale;
const PATH = `/${L}/style-guide`;

// Dev-server-only framework noise (the gate runs against `npm run dev`). These are
// benign and appear on every page, so they must not mask real errors. Everything
// else — bad CSS var, 404 asset, runtime throw — still fails the console check.
const DEV_CONSOLE_NOISE = [
  /hydrated but some attributes/i, // pre-hydration theme script on <html> (suppressHydrationWarning); prod-silent
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
];

test.describe("design-system showcase — parity", () => {
  test("mounts clean, with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !DEV_CONSOLE_NOISE.some((r) => r.test(m.text()))) {
        errors.push(m.text());
      }
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));

    const res = await page.goto(PATH, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(res?.ok(), "style-guide should return ok").toBeTruthy();
    await expect(
      page,
      "should not bounce to /login (auth problem, not a design finding)",
    ).not.toHaveURL(/\/login(\?|$)/);
    // Bad CSS vars / missing assets / runtime throws all surface here.
    expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("displayed hex values are the token-source values (computed, not typed)", async ({
    page,
  }) => {
    await page.goto(PATH, { waitUntil: "networkidle" });
    // innerText = rendered VISIBLE text only (excludes <script>/RSC payloads that
    // legitimately contain the word "undefined" in dev).
    const shown = await page.locator("main").first().innerText();

    // Every brand hex the page prints must equal the value in brand.config.ts.
    for (const hex of [
      brand.colors.primary,
      brand.colors.primaryEmphasis.light,
      brand.colors.primaryEmphasis.dark,
    ]) {
      expect(shown, `page must show the token value ${hex}`).toContain(hex);
    }
    // Series-1 chart hex is the brand — the single-source contract, on screen.
    expect(chartPalette[0]).toBe(brand.colors.primary);

    // No literal "undefined"/"NaN" leaked into any visible value.
    expect(shown).not.toMatch(/\b(undefined|NaN)\b/);
  });

  test("primary button hover is live (paint changes on hover)", async ({ page }) => {
    await page.goto(PATH, { waitUntil: "networkidle" });
    const btn = page.getByRole("button", { name: "Primary", exact: true }).first();
    await btn.scrollIntoViewIfNeeded();
    const paint = (el: Element) => {
      const s = getComputedStyle(el);
      return `${s.backgroundColor}|${s.opacity}|${s.filter}`;
    };
    const before = await btn.evaluate(paint);
    await btn.hover();
    // give the transition a beat to settle
    await page.waitForTimeout(250);
    const after = await btn.evaluate(paint);
    expect(after, "hover must change the button paint (style-hover is live)").not.toBe(before);
  });

  test("dark swap is live: [data-theme] flips --background", async ({ page }) => {
    await page.goto(PATH, { waitUntil: "networkidle" });
    const readBg = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      );
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    const light = await readBg();
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    const dark = await readBg();
    expect(light, "light --background should be set").not.toBe("");
    expect(dark, "dark [data-theme] must flip --background to a different value").not.toBe(light);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe clean (serious/critical) — ${theme}`, async ({ page }) => {
      if (theme === "dark") {
        await page.goto(`/${L}`, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.context().addCookies([{ name: "theme-mode", value: "dark", url: page.url() }]);
      }
      await page.goto(PATH, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      const detail = blocking
        .map((v) => `  - ${v.id} (${v.impact}): ${v.help} @ ${v.nodes[0]?.target.join(" ")}`)
        .join("\n");
      expect(blocking, `serious/critical axe on style-guide (${theme}):\n${detail}`).toEqual([]);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`visual parity vs baseline (<=1.5%) — ${theme}`, async ({ page }) => {
      if (theme === "dark") {
        await page.goto(`/${L}`, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.context().addCookies([{ name: "theme-mode", value: "dark", url: page.url() }]);
      }
      await page.goto(PATH, { waitUntil: "networkidle" });
      // Freeze the one animated element (the loading-skeleton toggle is off by
      // default; nothing else animates) and wait for webfonts so the diff is stable.
      await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
      await expect(page).toHaveScreenshot(`style-guide-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.015, // ≤1.5%, same bar as app screens
        animations: "disabled",
      });
    });
  }
});

// The flagship "Manzil" design-system showcase route (blueprint:
// docs/blueprints/design-system-showcase.md) — the branded landing built from the
// same tokens + AI primitives. Gated the same way so it can't drift silently.
const SHOWCASE = `/${L}/design-system`;

test.describe("design-system showcase route — parity", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`axe clean (serious/critical) — ${theme}`, async ({ page }) => {
      if (theme === "dark") {
        await page.goto(`/${L}`, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.context().addCookies([{ name: "theme-mode", value: "dark", url: page.url() }]);
      }
      await page.goto(SHOWCASE, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      const detail = blocking
        .map((v) => `  - ${v.id} (${v.impact}): ${v.help} @ ${v.nodes[0]?.target.join(" ")}`)
        .join("\n");
      expect(blocking, `serious/critical axe on design-system (${theme}):\n${detail}`).toEqual([]);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`visual parity vs baseline (<=1.5%) — ${theme}`, async ({ page }) => {
      if (theme === "dark") {
        await page.goto(`/${L}`, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.context().addCookies([{ name: "theme-mode", value: "dark", url: page.url() }]);
      }
      await page.goto(SHOWCASE, { waitUntil: "networkidle" });
      await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
      await expect(page).toHaveScreenshot(`design-system-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.015,
        animations: "disabled",
      });
    });
  }
});
