import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { defaultLocale } from "./_discover";

// C3 exit gate (ADR-029, Workstream C3): per-screen accessibility audit across
// the screens migrated off the AntD runtime onto the shadcn/Radix primitives.
// Runs axe-core against WCAG 2.0/2.1 A + AA and FAILS on any SERIOUS or CRITICAL
// violation — the "axe clean of serious/critical" bar in docs/uat-rubric.md.
//
// Unlike a11y.full.uat.ts (authenticated dashboard main-sections only, full mode),
// this is a lean spec that also covers the PUBLIC auth forms and the branded
// status pages, so the whole migrated surface named in the C3 exit bar is graded
// in one pass: auth forms, users, audit-log, recycling-bin, settings, dashboard,
// style-guide, status pages.

const L = defaultLocale;

type Screen = { name: string; path: string };

// Public (unauthenticated) — the branded split-screen auth forms.
const PUBLIC_SCREENS: Screen[] = [
  { name: "login", path: `/${L}/login` },
  { name: "forgot-password", path: `/${L}/forgot-password` },
  { name: "reset-password", path: `/${L}/reset-password?token=probe-token` },
];

// Authenticated — dashboard chrome + entity screens + branded status pages.
// Status pages sit behind auth (middleware bounces anon → login), so they render
// only with a session; navigating there directly renders the BrandedStatus view.
const AUTHED_SCREENS: Screen[] = [
  { name: "dashboard", path: `/${L}` },
  { name: "users", path: `/${L}/users` },
  { name: "users/new", path: `/${L}/users/new` },
  { name: "audit-log", path: `/${L}/audit-log` },
  { name: "recycling-bin", path: `/${L}/recycling-bin` },
  { name: "settings", path: `/${L}/settings` },
  { name: "settings/profile", path: `/${L}/settings/profile` },
  { name: "style-guide", path: `/${L}/style-guide` },
  { name: "status/forbidden", path: `/${L}/forbidden` },
  { name: "status/maintenance", path: `/${L}/maintenance` },
  { name: "status/not-found", path: `/${L}/__c3_not_found_probe` },
];

async function auditScreen(
  page: Page,
  screen: Screen,
  opts: { dark?: boolean; expectLoginBounce?: boolean } = {},
) {
  const { dark = false, expectLoginBounce = false } = opts;
  if (dark) {
    // Seed the theme-mode cookie so SSR + the pre-hydration script paint the dark
    // canvas before axe runs. This dark pass is only MEANINGFUL because <body>
    // now paints var(--background) (globals.css) — axe-core can't model
    // color-scheme:dark, so a transparent body floods dark axe with bogus
    // color-contrast findings (Workstream D follow-up, session 11).
    await page.goto(`/${L}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page
      .context()
      .addCookies([{ name: "theme-mode", value: "dark", url: page.url() }]);
  }
  const res = await page.goto(screen.path, { waitUntil: "domcontentloaded" });
  // Let client chrome settle; don't hard-fail if a long-poll keeps the network busy.
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(res, `${screen.name} should get a response`).toBeTruthy();

  if (!expectLoginBounce) {
    await expect(
      page,
      `${screen.name} should not bounce to /login (auth/session problem, not a design finding)`,
    ).not.toHaveURL(/\/login(\?|$)/);
  }

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  const detail = blocking
    .map(
      (v) =>
        `  - ${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes
          .slice(0, 8)
          .map((n) => `      @ ${n.target.join(" ")}\n        ${n.failureSummary?.replace(/\n/g, "\n        ")}`)
          .join("\n"),
    )
    .join("\n");

  expect(
    blocking,
    `${screen.name} (${screen.path}) has ${blocking.length} serious/critical axe violation(s):\n${detail}`,
  ).toEqual([]);
}

test.describe("C3 a11y — public auth forms (unauthenticated)", () => {
  // Override the project's admin storageState so these render as a real anon user.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const screen of PUBLIC_SCREENS) {
    test(`a11y: ${screen.name}`, async ({ page }) => {
      await auditScreen(page, screen);
    });
  }
});

test.describe("C3 a11y — authenticated screens + status pages", () => {
  for (const screen of AUTHED_SCREENS) {
    test(`a11y: ${screen.name}`, async ({ page }) => {
      await auditScreen(page, screen);
    });
  }
});

// Dark-mode pass (Workstream D, session 11): now that <body> paints
// var(--background), axe sees the real dark canvas and this is a genuine
// regression check for the split brand/red-as-text tokens (--primary-emphasis /
// --destructive-emphasis) and the dark surfaces. Same serious/critical bar.
test.describe("C3 a11y — public auth forms (dark)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const screen of PUBLIC_SCREENS) {
    test(`a11y dark: ${screen.name}`, async ({ page }) => {
      await auditScreen(page, screen, { dark: true });
    });
  }
});

test.describe("C3 a11y — authenticated screens + status pages (dark)", () => {
  for (const screen of AUTHED_SCREENS) {
    test(`a11y dark: ${screen.name}`, async ({ page }) => {
      await auditScreen(page, screen, { dark: true });
    });
  }
});
