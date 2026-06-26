import { test, expect } from "@playwright/test";
import { defaultLocale } from "./_discover";

// Acceptance + light security smoke: an UNAUTHENTICATED visitor must be bounced
// to login. Runs with an empty session (overrides the saved admin storageState).
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto(`/${defaultLocale}`);
  await expect(page).toHaveURL(/\/login/);
});
