import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  discoverMainSections,
  defaultLocale,
  rtlLocale,
  rtlEnabled,
  type Screen,
} from "./_discover";

// P4 (Build C) — UI/UX SWEEP. FULL mode only (`*.full.uat.ts`).
//
// Runs as ADMIN (chromium default storage state) across EACH main section
// DISCOVERED from the route tree (never hardcoded). Per section it checks the
// health signals that matter for a stakeholder-facing prototype:
//
//   - No uncaught runtime errors (page `pageerror`) while the screen loads.
//   - The screen renders real content (a visible heading), not a blank error shell.
//   - RTL works (ONLY when the fork ships an RTL locale): the Arabic (`ar`)
//     variant flips <html dir> to "rtl". English-only forks skip this check.
//   - Console errors are tallied (recorded as findings, not failed — they're
//     noisy and often library dev-warnings; uncaught errors above are the gate).
//
// Per-section findings are appended to uat-results/uiux-findings.json for the
// PDF (P4 section). Screenshots of the en + ar variants are attached.

// Source + RTL locales come from project.config.json via _discover (the single
// config source) — never hardcoded "en"/"ar". The base sweep runs in the
// default locale; the RTL variant runs ONLY when the fork ships an RTL locale.
const EN = defaultLocale;
const AR = rtlLocale ?? "ar";
const SECTIONS = discoverMainSections(EN);
const RTL_ENABLED = rtlEnabled;
const FINDINGS_FILE = path.join(
  process.cwd(),
  "uat-results",
  "uiux-findings.json",
);

type Finding = {
  section: string;
  path: string;
  pageErrors: number;
  consoleErrors: number;
  headingOk: boolean;
  rtlOk: boolean;
  notes: string[];
};

/** Append/replace this section's finding in the shared sink (never throws). */
function recordFinding(finding: Finding): void {
  try {
    fs.mkdirSync(path.dirname(FINDINGS_FILE), { recursive: true });
    let rows: Finding[] = [];
    if (fs.existsSync(FINDINGS_FILE)) {
      try {
        rows = JSON.parse(fs.readFileSync(FINDINGS_FILE, "utf8")) as Finding[];
      } catch {
        rows = [];
      }
    }
    rows = rows.filter((r) => r.section !== finding.section);
    rows.push(finding);
    fs.writeFileSync(FINDINGS_FILE, JSON.stringify(rows, null, 2));
  } catch {
    // Findings file is a reporting nicety; a write failure must not fail the test.
  }
}

/** The RTL variant of a default-locale path (`/en/users` -> `/ar/users`),
 *  swapping the configured default-locale prefix for the RTL locale. */
function toArabic(enPath: string): string {
  return enPath.replace(new RegExp(`^/${EN}(/|$)`), `/${AR}$1`);
}

for (const section of SECTIONS as Screen[]) {
  test(`UI/UX sweep — ${section.name}`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const notes: string[] = [];

    // --- EN load + content + runtime-error check ----------------------------
    await page.goto(section.path, { waitUntil: "networkidle" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // Wait for the heading (don't snapshot isVisible() instantly): a cold Vercel
    // serverless function + a client-island page may not have painted its <h2>
    // within the short networkidle above. An instant check there is a false
    // "blank shell" on cold starts. Give it a real grace budget instead.
    const heading = page.locator("h1, h2").first();
    const headingOk = await heading
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!headingOk) notes.push("no visible <h1>/<h2> heading (blank shell?)");

    await testInfo.attach(`${section.name}-en.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    // --- AR (RTL) variant ---------------------------------------------------
    // Skipped (and treated as vacuously OK) when the fork ships no RTL locale.
    let rtlOk = true;
    if (RTL_ENABLED) {
      rtlOk = false;
      try {
        await page.goto(toArabic(section.path), { waitUntil: "networkidle" });
        const dir = await page.locator("html").getAttribute("dir");
        rtlOk = dir === "rtl";
        if (!rtlOk) notes.push(`ar variant <html dir> was "${dir}", expected "rtl"`);
        await testInfo.attach(`${section.name}-ar.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      } catch (e) {
        notes.push(
          `ar variant failed to load: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      notes.push("RTL not configured (no ar locale) — RTL assertion skipped");
    }

    if (consoleErrors.length > 0) {
      notes.push(`${consoleErrors.length} console error(s) — see report detail`);
    }

    recordFinding({
      section: section.name,
      path: section.path,
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      headingOk,
      rtlOk,
      notes,
    });

    // Gate on the signals that are real defects regardless of app:
    //   - uncaught runtime exceptions (a broken screen), and
    //   - a blank shell with no heading (render failure / error boundary), and
    //   - RTL not applying for the Arabic locale (an i18n regression the template
    //     guarantees against).
    expect(
      pageErrors,
      `${section.name} threw uncaught runtime error(s): ${pageErrors.join(" | ")}`,
    ).toHaveLength(0);
    expect(headingOk, `${section.name} rendered no heading (blank shell?)`).toBe(
      true,
    );
    // Only a gate when RTL is configured; English-only forks pass vacuously.
    expect(rtlOk, `${section.name} ar variant did not apply dir="rtl"`).toBe(true);
  });
}

// Loud guard so a broken discovery (empty section list) fails visibly.
test("UI/UX discovery is non-empty", () => {
  expect(SECTIONS.length, "no main sections discovered for the UI/UX sweep").toBeGreaterThan(0);
});
