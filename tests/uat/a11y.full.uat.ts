import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverMainSections } from "./_discover";

// DQ-3: automated accessibility gate in the UAT pipeline. Walks each main
// dashboard section (discovered at runtime, like smoke.uat.ts) and runs axe-core
// against WCAG 2.0/2.1 A + AA, failing on SERIOUS or CRITICAL violations. Runs
// authenticated (auth.setup.ts storage state), so it scans the real dashboard
// chrome -- not just static markup. Matches the UI Definition of Done in
// docs/uat-rubric.md: "axe clean of serious/critical".

const screens = discoverMainSections("en");

// The style-guide is a deliberate token SHOWROOM (not in the sidebar nav): it
// renders the raw AntD preset palettes (Tag green/gold/red), the semantic
// Typography types, and brand swatches ON PURPOSE, several of which ship below
// AA as text/swatch demos. We still gate its STRUCTURE strictly (labels,
// button-names, svg-alt, etc.) but exempt color-contrast there — product
// screens carry NO such exemption. Adjudicated wave-off: docs/findings-register.md
// (DQA-2026-06-26). Anchored to the depth-1 dashboard route (locale-prefixed)
// so a deeper route ending in /style-guide can't silently inherit the exemption.
const isTokenShowroom = (path: string) => /^\/[a-z-]+\/style-guide\/?$/.test(path);

for (const screen of screens) {
  test(`a11y: ${screen.name} has no serious/critical axe violations`, async ({ page }) => {
    const res = await page.goto(screen.path, { waitUntil: "networkidle" });
    expect(res?.status(), `${screen.name} should respond < 400`).toBeLessThan(400);
    await expect(page, `${screen.name} should not bounce to login`).not.toHaveURL(
      /\/login/,
    );

    let builder = new AxeBuilder({ page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
    ]);
    if (isTokenShowroom(screen.path)) {
      builder = builder.disableRules(["color-contrast"]);
    }
    const results = await builder.analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    expect(
      blocking,
      `${screen.name} has ${blocking.length} serious/critical axe violation(s):\n` +
        blocking
          .map((v) => `  - ${v.id} (${v.impact}): ${v.help} [${v.nodes.length} node(s)]`)
          .join("\n"),
    ).toEqual([]);
  });
}
