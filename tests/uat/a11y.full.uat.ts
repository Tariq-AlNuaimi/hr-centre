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

for (const screen of screens) {
  test(`a11y: ${screen.name} has no serious/critical axe violations`, async ({ page }) => {
    const res = await page.goto(screen.path, { waitUntil: "networkidle" });
    expect(res?.status(), `${screen.name} should respond < 400`).toBeLessThan(400);
    await expect(page, `${screen.name} should not bounce to login`).not.toHaveURL(
      /\/login/,
    );

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

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
