import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { discoverMainSections, defaultLocale } from "./_discover";

// FULL-mode automated accessibility gate (closes the deferred a11y matrix gap).
// Walks every main dashboard section (discovered at runtime, like smoke.uat.ts)
// PLUS the public, candidate-facing surfaces (login + the methodology page that
// candidates and auditors are shown), and runs axe-core against WCAG 2.0/2.1
// A + AA, failing on SERIOUS or CRITICAL violations. The dashboard scans run
// authenticated (auth.setup.ts storage state), so they cover the real app chrome
// — not just static markup. Matches the UI Definition of Done in
// docs/uat-rubric.md and UI-SPEC A.7 ("axe clean of serious/critical").
//
// The candidate RUNNER (/a/[token]) is brand-critical too but is EXCLUDED from
// this automated gate: it needs a live invitation token, which the harness does
// not mint. Its a11y coverage relies on the Phase-4 MANUAL axe pass (16 combos:
// EN+AR × light/dark × mobile; see docs/findings-register.md). A future
// improvement: mint a raw token via lib/token in a setup fixture so the runner
// joins this gate.

type Target = { name: string; path: string; public: boolean };

// Authenticated dashboard sections, discovered from the route tree.
const dashboardTargets: Target[] = discoverMainSections(defaultLocale).map((s) => ({
  name: s.name,
  path: s.path,
  public: false,
}));

// Public, unauthenticated, candidate-facing surfaces (UI-SPEC C + D.11).
const publicTargets: Target[] = [
  { name: "login", path: `/${defaultLocale}/login`, public: true },
  { name: "methodology", path: `/${defaultLocale}/methodology`, public: true },
];

const targets = [...dashboardTargets, ...publicTargets];

test("a11y discovery is non-empty", () => {
  // A vacuous green (broken route scan) must fail loudly, not silently pass.
  expect(dashboardTargets.length, "no dashboard sections discovered").toBeGreaterThan(0);
});

for (const target of targets) {
  test(`a11y: ${target.name} has no serious/critical axe violations`, async ({ page }) => {
    const res = await page.goto(target.path, { waitUntil: "networkidle" });
    expect(res?.status(), `${target.name} should respond < 400`).toBeLessThan(400);
    if (!target.public) {
      await expect(page, `${target.name} should not bounce to login`).not.toHaveURL(
        /\/login/,
      );
    }

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    expect(
      blocking,
      `${target.name} has ${blocking.length} serious/critical axe violation(s):\n` +
        blocking
          .map((v) => `  - ${v.id} (${v.impact}): ${v.help} [${v.nodes.length} node(s)]`)
          .join("\n"),
    ).toEqual([]);
  });
}
