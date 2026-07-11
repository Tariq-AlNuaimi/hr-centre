import { test, expect } from "@playwright/test";
import { discoverMainSections } from "./_discover";

// LEAN breadth pass — walk only the MAIN sections (top-level nav), DISCOVERED at
// runtime from the dashboard route tree (see _discover.ts). No hardcoded list, so
// it auto-covers any top-level section you scaffold. Sub-pages, create forms,
// record pages, every-button + CRUD journeys are FULL mode's job (*.full.uat.ts).
//
// Each step asserts the screen loads (status < 400, not bounced to login) and
// attaches a full-page screenshot — the screenshots double as the stakeholder
// artifact, and the JSON reporter's attachments feed `npm run uat:pdf`.

const screens = discoverMainSections("en");

test("discovers at least one main section", () => {
  // Guard: an empty discovery means the route scan broke (or cwd is wrong) — fail
  // loudly rather than report a vacuous green.
  expect(screens.length, "route discovery found no main sections").toBeGreaterThan(0);
});

for (const screen of screens) {
  test(`loads ${screen.name}`, async ({ page }, testInfo) => {
    const res = await page.goto(screen.path, { waitUntil: "networkidle" });
    expect(res?.status(), `${screen.name} should respond < 400`).toBeLessThan(400);
    await expect(page, `${screen.name} should not bounce to login`).not.toHaveURL(/\/login/);

    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${screen.name}.png`, {
      body: shot,
      contentType: "image/png",
    });
  });
}
