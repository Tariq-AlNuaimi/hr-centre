import { test as setup } from "@playwright/test";
import { defaultLocale } from "./_discover";

// Logs in as the admin once and saves the session to disk so the UAT flows
// run as an authenticated user. Credentials come from env — NEVER hardcoded.
//   UAT_EMAIL / UAT_PASSWORD   (preferred for a dedicated UAT account)
//   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  (fallback — the seeded admin)

const authFile = "uat-results/.auth/admin.json";

setup("authenticate as admin", async ({ page }) => {
  const email = process.env.UAT_EMAIL ?? process.env.SEED_ADMIN_EMAIL;
  const password = process.env.UAT_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "UAT needs login credentials. Set UAT_EMAIL/UAT_PASSWORD (or SEED_ADMIN_EMAIL/" +
        "SEED_ADMIN_PASSWORD) in your environment. Do not hardcode them in the test.",
    );
  }

  await page.goto(`/${defaultLocale}/login`);

  // Select by the field `name` (spread from the react-hook-form binding onto the
  // input) — locale-independent and stable across the C2/C3 migration off AntD,
  // where the shadcn form control's `id` is a generated useId(), not "email".
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  // On success the app routes to the dashboard at /<defaultLocale>.
  await page.waitForURL(new RegExp(`/${defaultLocale}/?$`), { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
