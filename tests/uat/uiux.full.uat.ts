import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  discoverMainSections,
  discoverSectionAccess,
  defaultLocale,
  rtlLocale,
  rtlEnabled,
  type Screen,
} from "./_discover";
import { NAV_ITEMS } from "@/components/layout/nav";

// FULL-mode UI/UX SWEEP (closes part of the deferred QA matrix).
//
// Runs as ADMIN (chromium default storage state) across EACH main section
// DISCOVERED from the route tree (never hardcoded). Per section it checks the
// health signals that matter for a stakeholder-facing prototype:
//
//   - No uncaught runtime errors (page `pageerror`) while the screen loads.
//   - The screen renders real content (a visible heading), not a blank error shell.
//   - RTL works (the fork ships `ar`): the Arabic variant flips <html dir> to "rtl".
//   - Console errors are tallied (recorded as findings, not failed — they're
//     noisy and often library dev-warnings; uncaught errors above are the gate).
//
// A final test cross-checks NAV visibility against the SERVER gate (the
// nav-vs-authz consistency referenced in _discover.ts) — catching the dangerous
// direction where a manager-visible nav link points at an admin-only page.
//
// Per-section findings are appended to uat-results/uiux-findings.json for the PDF.

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

/** The RTL variant of a default-locale path (`/en/app/roles` -> `/ar/app/roles`). */
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

    expect(
      pageErrors,
      `${section.name} threw uncaught runtime error(s): ${pageErrors.join(" | ")}`,
    ).toHaveLength(0);
    expect(headingOk, `${section.name} rendered no heading (blank shell?)`).toBe(true);
    expect(rtlOk, `${section.name} ar variant did not apply dir="rtl"`).toBe(true);
  });
}

// Nav-vs-server gating consistency (the check _discover.ts defers to here).
//
// nav.ts declares per-item `adminOnly` (nav VISIBILITY); the page's authz call
// is the SERVER gate. Two divergences are possible:
//   - DANGEROUS: nav shows an item to managers (adminOnly !== true) but the page
//     is requireAdmin -> a manager clicks a visible link and gets bounced. This
//     is a real UX/RBAC bug; we FAIL on it.
//   - BENIGN: nav HIDES an item from managers (adminOnly === true) but the page
//     is requireSession -> manager-readable by URL though decluttered from nav.
//     This fork does this deliberately for role profiles; we RECORD it, not fail.
test("nav visibility is consistent with the server gate", () => {
  const serverAdminOnly = new Map(
    discoverSectionAccess(EN).map((s) => [s.name, s.adminOnly]),
  );

  const sectionNameForHref = (href: string): string => {
    // nav hrefs are under /app: "/app" -> dashboard, "/app/<seg>" -> "<seg>".
    const rest = href.replace(/^\/app\/?/, "");
    return rest === "" ? "dashboard" : rest;
  };

  // Sections that nav HIDES from managers (adminOnly) yet are intentionally
  // manager-READABLE by URL (requireSession). This is the explicit, documented
  // exception list — nav.ts is otherwise the independent oracle for "admin-only
  // intent", so any OTHER under-protected section is a real finding. Keeping the
  // app's one intentional case here (role profiles: manager read-only) is what
  // lets the check FAIL a genuine gate deletion instead of waving it through as
  // "benign" (the false-green the page-derived matrix alone can't catch).
  const INTENTIONAL_MANAGER_READABLE = new Set<string>(["roles"]);

  const dangerous: string[] = []; // nav shows to managers, but page is requireAdmin
  const underProtected: string[] = []; // nav marks admin-only, but page isn't gated
  const benign: string[] = []; // the documented intentional exceptions

  for (const item of NAV_ITEMS) {
    const name = sectionNameForHref(item.href);
    if (!serverAdminOnly.has(name)) continue; // a nav target not in the main-section scan
    const navAdminOnly = item.adminOnly === true;
    const pageAdminOnly = serverAdminOnly.get(name) === true;
    if (navAdminOnly === pageAdminOnly) continue;

    if (!navAdminOnly && pageAdminOnly) {
      dangerous.push(`${name}: nav shows it to managers but page is requireAdmin (bounce)`);
    } else if (INTENTIONAL_MANAGER_READABLE.has(name)) {
      benign.push(`${name}: nav hides it from managers but page is requireSession (read-only by URL)`);
    } else {
      underProtected.push(
        `${name}: nav marks it admin-only but the page is NOT requireAdmin — ` +
          `a manager can reach it by URL (gate missing / removed?)`,
      );
    }
  }

  if (benign.length > 0) {
    console.warn("nav-vs-server (benign, by design): " + benign.join("; "));
  }

  // Both directions are real defects; nav.ts is the independent intent oracle so
  // a deleted requireAdmin on a nav-admin section is caught here even though the
  // page-derived matrix would (by construction) still pass it.
  expect(
    [...dangerous, ...underProtected],
    "nav/server RBAC gate inconsistency (broken UX or under-protected admin surface):\n  " +
      [...dangerous, ...underProtected].join("\n  "),
  ).toEqual([]);
});

// Loud guard so a broken discovery (empty section list) fails visibly.
test("UI/UX discovery is non-empty", () => {
  expect(SECTIONS.length, "no main sections discovered for the UI/UX sweep").toBeGreaterThan(0);
});
