import { test, expect } from "@playwright/test";

// Acceptance + light security smoke: an UNAUTHENTICATED visitor must be bounced
// to login. Runs with an empty session (overrides the saved admin storageState).
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto("/en");
  await expect(page).toHaveURL(/\/login/);
});
