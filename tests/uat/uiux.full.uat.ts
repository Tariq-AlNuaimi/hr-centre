import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  discoverMainSections,
  discoverCrudEntities,
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
const FINDINGS_FILE = path.join(process.cwd(), "uat-results", "uiux-findings.json");

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
        notes.push(`ar variant failed to load: ${e instanceof Error ? e.message : String(e)}`);
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
    expect(headingOk, `${section.name} rendered no heading (blank shell?)`).toBe(true);
    // Only a gate when RTL is configured; English-only forks pass vacuously.
    expect(rtlOk, `${section.name} ar variant did not apply dir="rtl"`).toBe(true);
  });
}

// --- RTL overlay geometry (Workstream D) ------------------------------------
//
// The <html dir> flip (asserted per-section above) proves the DOCUMENT mirrors,
// but Radix's portalled overlays (dropdown menu, popover) are positioned by JS
// off the DirectionProvider dir — not by CSS — so a broken/missing
// DirectionProvider dir="rtl" would leave <html dir="rtl"> correct while the
// menus still open LTR-aligned. This block closes that gap: in the Arabic (ar)
// locale it OPENS a dropdown menu AND a popover and asserts each opens MIRRORED
// for RTL via getBoundingClientRect() geometry (Playwright boundingBox()).
//
// Guarded on the fork actually shipping an RTL locale, exactly like the per-
// section RTL check above (English-only forks skip it).
test("RTL overlay geometry — dropdown & popover mirror for ar", async ({ page }, testInfo) => {
  test.skip(!RTL_ENABLED, "RTL not configured (no ar locale) — overlay geometry check skipped");
  test.setTimeout(60_000);

  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  // An overlay edge that is "pinned" to a trigger edge may drift a few px
  // (content padding, Radix collision nudge) yet still read as aligned to it.
  // The WRONG (un-mirrored) edge is off by ~the content/trigger width — for the
  // tiny filter icon vs. its 160px menu that's >100px — so this tolerance still
  // cleanly separates a mirrored overlay from an LTR-positioned one.
  const EDGE_TOL = 28;
  // How far off the viewport edges an overlay may sit (sub-pixel rounding only).
  const VIEWPORT_SLOP = 2;

  // Discovery-driven target: a dashboard list that carries BOTH the header
  // (present on every dashboard page) and a DataTable column-filter popover (a
  // filterable column). The shipped `users` list has a role filter; a scaffolded
  // entity with an enum column gets one for free. Navigate the ar variant of
  // each CRUD list until one exposes a header filter toggle.
  const lists = discoverCrudEntities(AR);
  let listPath: string | null = null;
  for (const e of lists) {
    await page.goto(e.listPath, { waitUntil: "networkidle" });
    if (await page.locator('thead [aria-haspopup="dialog"]').count()) {
      listPath = e.listPath;
      break;
    }
  }
  test.skip(
    listPath === null,
    "no filterable list discovered — RTL popover geometry not applicable here",
  );

  // Sanity: the document itself must be RTL before overlay mirroring is meaningful.
  const dir = await page.locator("html").getAttribute("dir");
  expect(dir, "ar list must render <html dir='rtl'> before overlay geometry is asserted").toBe(
    "rtl",
  );

  // --- Dropdown menu: header user menu (align="end") ----------------------
  // The user menu is the LAST aria-haspopup="menu" trigger in the header
  // (components/layout/AppHeader.tsx — OrgSwitcher is the first menu trigger).
  const menuTrigger = page.locator('header [aria-haspopup="menu"]').last();
  await menuTrigger.click();
  const menu = page.locator('[role="menu"]').first();
  await menu.waitFor({ state: "visible" });
  const mt = await menuTrigger.boundingBox();
  const mc = await menu.boundingBox();
  await testInfo.attach("rtl-dropdown-ar.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(mt && mc, "dropdown trigger + content must be laid out").toBeTruthy();
  if (mt && mc) {
    // align="end" + dir="rtl": Radix flips the logical END edge from right (LTR)
    // to left, so the menu MIRRORS to pin its LEFT edge to the trigger's LEFT
    // edge. This left-edge alignment IS the align-end→physical-left RTL flip.
    expect(
      Math.abs(mc.x - mt.x),
      "rtl dropdown: content left edge should align with the trigger's left edge",
    ).toBeLessThan(EDGE_TOL);
    // …and the mirrored menu is not clipped off either side of the viewport.
    expect(
      mc.x,
      "rtl dropdown must not overflow off the left of the viewport",
    ).toBeGreaterThanOrEqual(-VIEWPORT_SLOP);
    expect(
      mc.x + mc.width,
      "rtl dropdown must not overflow off the right of the viewport",
    ).toBeLessThanOrEqual(vp.width + VIEWPORT_SLOP);
  }
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" }).catch(() => {});

  // --- Popover: DataTable column-filter toggle (align="start") ------------
  // The filter toggle is a Radix Popover trigger in the table header
  // (components/shared/DataTable.tsx — PopoverTrigger, aria-haspopup="dialog");
  // its content is passed align="start".
  const popTrigger = page.locator('thead [aria-haspopup="dialog"]').first();
  await popTrigger.click();
  const pop = page.locator('[role="dialog"]').first();
  await pop.waitFor({ state: "visible" });
  const pt = await popTrigger.boundingBox();
  const pc = await pop.boundingBox();
  await testInfo.attach("rtl-popover-ar.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(pt && pc, "popover trigger + content must be laid out").toBeTruthy();
  if (pt && pc) {
    // align="start" + dir="rtl": Radix flips the logical START edge from left
    // (LTR) to right, so the popover MIRRORS to pin its RIGHT edge to the
    // trigger's RIGHT edge — the canonical "opens toward the RTL start" signal.
    expect(
      Math.abs(pc.x + pc.width - (pt.x + pt.width)),
      "rtl popover: content right edge should align with the trigger's right edge",
    ).toBeLessThan(EDGE_TOL);
    // …and the popover, extending leftward from that right edge, does not spill
    // off the left of the viewport.
    expect(
      pc.x,
      "rtl popover must not overflow off the left of the viewport",
    ).toBeGreaterThanOrEqual(-VIEWPORT_SLOP);
    expect(
      pc.x + pc.width,
      "rtl popover must not overflow off the right of the viewport",
    ).toBeLessThanOrEqual(vp.width + VIEWPORT_SLOP);
  }
});

// Loud guard so a broken discovery (empty section list) fails visibly.
test("UI/UX discovery is non-empty", () => {
  expect(SECTIONS.length, "no main sections discovered for the UI/UX sweep").toBeGreaterThan(0);
});
