import { test, expect } from "@playwright/test";

// Authenticated smoke walkthrough of the template's shipped screens.
// Each step asserts the screen loads (not bounced to login) and attaches a
// full-page screenshot — the screenshots double as the artifact you can send
// to stakeholders for review.
//
// When you scaffold new entities, add their screens here (or ask /uat to
// regenerate this list from the app's routes).

const screens = [
  { name: "dashboard", path: "/en" },
  { name: "users", path: "/en/users" },
  { name: "audit-log", path: "/en/audit-log" },
  { name: "recycling-bin", path: "/en/recycling-bin" },
  { name: "settings", path: "/en/settings" },
];

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
