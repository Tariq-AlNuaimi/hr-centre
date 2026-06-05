import { test, expect } from "@playwright/test";
import { discoverScreens } from "./_discover";

// Authenticated smoke walkthrough of the app's shipped screens — the lean breadth
// pass. The screen list is DISCOVERED at runtime from the dashboard route tree
// (see _discover.ts), so this auto-covers any entity you scaffold without anyone
// editing a hardcoded array.
//
// Each step asserts the screen loads (status < 400, not bounced to login) and
// attaches a full-page screenshot — the screenshots double as the artifact you
// send stakeholders, and the JSON reporter's attachments feed `npm run uat:pdf`.

const screens = discoverScreens("en");

test("discovers at least one screen", () => {
  // Guard: an empty discovery means the route scan broke (or cwd is wrong) — fail
  // loudly rather than report a vacuous green.
  expect(screens.length, "route discovery found no dashboard screens").toBeGreaterThan(0);
});

for (const screen of screens) {
  test(`loads ${screen.name}`, async ({ page }, testInfo) => {
    const res = await page.goto(screen.path, { waitUntil: "networkidle" });
    expect(res?.status(), `${screen.name} should respond < 400`).toBeLessThan(400);
    await expect(page, `${screen.name} should not bounce to login`).not.toHaveURL(
      /\/login/,
    );

    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${screen.name}.png`, {
      body: shot,
      contentType: "image/png",
    });
  });
}
