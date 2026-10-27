import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV, NAV_GROUPS, type NavContext } from "../../lib/nav/config";
import {
  activeNav,
  groupedNav,
  normalisePath,
  paletteItems,
  tabsFor,
  visibleNav,
} from "../../lib/nav/resolve";
import { legacyRedirects } from "../../lib/nav/legacy-redirects";
import { navTrail } from "../../lib/nav/trail";

/**
 * UX P1 phase 1 (docs/blueprints/ux-p1-nav.md): one nav config feeds the
 * sidebar, the module tab bars, ⌘K and the breadcrumbs.
 */

const NONE: NavContext = {
  isAdmin: false,
  employeeId: null,
  pms: {
    hr: false,
    lineManager: false,
    orgWide: false,
    runCalibration: false,
    previewImport: false,
    orgManage: false,
    loginsManage: false,
  },
  hive: { seeTickets: false, viewReports: false, editContent: false, configure: false },
  jml: () => false,
  hiring: () => false,
};

const ALL: NavContext = {
  isAdmin: true,
  employeeId: "emp-me",
  pms: {
    hr: true,
    lineManager: true,
    orgWide: true,
    runCalibration: true,
    previewImport: true,
    orgManage: true,
    loginsManage: true,
  },
  hive: { seeTickets: true, viewReports: true, editContent: true, configure: true },
  jml: () => true,
  hiring: () => true,
};

const keys = (ctx: NavContext) => visibleNav(ctx).map((e) => e.key);

/** Every URL path a dashboard page.tsx serves (route groups stripped, `[x]` → `:x`). */
function dashboardRoutes(): Set<string> {
  const root = "app/[locale]/(dashboard)";
  const out = new Set<string>();
  const walk = (dir: string, parts: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        const seg = /^\(.*\)$/.test(name) ? null : name.replace(/^\[(.+)\]$/, ":$1");
        walk(full, seg === null ? parts : [...parts, seg]);
      } else if (name === "page.tsx") {
        out.add("/" + parts.join("/"));
      }
    }
  };
  walk(root, []);
  return out;
}

test("keys are unique across entries and tabs", () => {
  const all = NAV.flatMap((e) => [e.key, ...(e.tabs ?? []).map((t) => t.key)]);
  assert.equal(new Set(all).size, all.length);
});

test("every label is an English nav message", () => {
  const nav = JSON.parse(readFileSync("messages/en.json", "utf8")).nav as Record<string, unknown>;
  for (const link of NAV.flatMap((e) => [e, ...(e.tabs ?? [])])) {
    assert.equal(typeof nav[link.label], "string", `nav.${link.label} missing`);
  }
  const groups = nav.group as Record<string, string>;
  for (const g of NAV_GROUPS) assert.equal(typeof groups[g], "string", `nav.group.${g}`);
});

test("every destination is a real page", () => {
  const routes = dashboardRoutes();
  const hrefs = paletteItems(ALL).map((i) => i.href.replace("/people/emp-me", "/people/:id"));
  for (const href of hrefs) assert.ok(routes.has(href), `${href} has no page.tsx`);
});

test("a full-access user sees at most 17 sidebar entries, in task-based groups", () => {
  const entries = visibleNav(ALL);
  assert.ok(entries.length <= 17, `got ${entries.length}`);
  assert.deepEqual(
    groupedNav(ALL).map((g) => g.group),
    ["home", "me", "team", "people", "talent", "service", "insights", "admin"],
  );
});

test("fails closed: no access shows Home, My performance, Directory and Org chart", () => {
  assert.deepEqual(keys(NONE), ["home", "me-performance", "people", "org"]);
  assert.deepEqual(
    groupedNav(NONE).map((g) => g.group),
    ["home", "me", "people"],
  );
});

test("a line manager gets My profile and My team, nothing administrative", () => {
  const manager = { ...NONE, employeeId: "e1", pms: { ...NONE.pms, lineManager: true } };
  assert.deepEqual(keys(manager), [
    "home",
    "me-profile",
    "me-performance",
    "team",
    "people",
    "org",
  ]);
  assert.equal(visibleNav(manager).find((e) => e.key === "me-profile")?.href, "/people/e1");
});

test("an entry opens on its first tab the viewer may use", () => {
  const reportsOnly = { ...NONE, hive: { ...NONE.hive, viewReports: true } };
  const insights = visibleNav(reportsOnly).find((e) => e.key === "insights");
  assert.equal(insights?.href, "/tickets/reports");
  assert.deepEqual(
    insights?.tabs.map((t) => t.key),
    ["ticket-reports"],
  );
  // A single visible tab is not a tab bar.
  assert.equal(tabsFor("/tickets/reports", reportsOnly), null);
});

test("the active entry is the longest matching prefix", () => {
  const at = (p: string) => {
    const a = activeNav(p, ALL);
    return a && `${a.entryKey}/${a.tabKey}`;
  };
  assert.equal(at("/"), "home/null");
  assert.equal(at("/jml/reports"), "insights/jml-reports");
  assert.equal(at("/jml/cases/abc"), "jml/jml-cases");
  assert.equal(at("/jml/settings/templates"), "settings/jml-settings");
  assert.equal(at("/hiring/panel/x/score"), "me-interviews/null");
  assert.equal(at("/hiring/planning"), "hiring/hiring-requisitions");
  assert.equal(at("/hiring/flow"), "hiring/hiring-home");
  assert.equal(at("/people/emp-me"), "me-profile/null");
  assert.equal(at("/people/someone-else"), "people/null");
  assert.equal(at("/tickets/abc"), "tickets/null");
  assert.equal(at("/tickets/reports"), "insights/ticket-reports");
  assert.equal(at("/tickets/setup/pairs"), "settings/ticket-setup");
  assert.equal(at("/calibration"), "performance-cycles/calibration");
  assert.equal(at("/settings/profile"), null);
});

test("the tab bar is the owning module's visible tabs", () => {
  const found = tabsFor("/jml/cases/abc", ALL);
  assert.equal(found?.entry.key, "jml");
  assert.equal(found?.activeTab, "jml-cases");
  assert.ok((found?.entry.tabs.length ?? 0) >= 8);
});

test("breadcrumb head: module, then its tab unless it is the landing tab", () => {
  const cal = navTrail("/calibration", ALL);
  assert.deepEqual(
    cal?.crumbs.map((c) => [c.key, c.href]),
    [
      ["performance-cycles", "/admin/cycles"],
      ["calibration", "/calibration"],
    ],
  );
  assert.equal(cal?.restFrom, "/calibration");
  assert.deepEqual(
    navTrail("/admin/cycles", ALL)?.crumbs.map((c) => c.key),
    ["performance-cycles"],
  );
  // An extra `match` prefix keeps its own segment in the rest of the trail.
  assert.equal(navTrail("/hiring/planning", ALL)?.restFrom, "/hiring");
  assert.equal(navTrail("/", ALL), null);
});

test("⌘K lists every destination the viewer may open, with its module", () => {
  const items = paletteItems(ALL);
  const cal = items.find((i) => i.key === "calibration");
  assert.equal(cal?.parent?.key, "performance-cycles");
  assert.ok(!paletteItems(NONE).some((i) => i.key === "audit-log"));
});

test("normalisePath strips the locale and trailing slash", () => {
  assert.equal(normalisePath("/en/jml/cases/", ["en"]), "/jml/cases");
  assert.equal(normalisePath("/en", ["en"]), "/");
});

test("HR tickets: every old /hive page redirects to a page that exists; none remain", () => {
  const routes = dashboardRoutes();
  assert.ok(![...routes].some((r) => r.startsWith("/hive")), "a /hive page still exists");
  const redirects = legacyRedirects();
  for (const r of redirects.filter((x) => !x.source.startsWith("/:locale"))) {
    const dest = r.destination;
    assert.ok(routes.has(dest), `${r.source} → ${dest} has no page`);
  }
  const byLocale = redirects.find((r) => r.source === "/:locale([a-z]{2})/hive/escalations/:id");
  assert.equal(byLocale?.destination, "/:locale/tickets/:id");
  assert.ok(redirects.every((r) => r.permanent));
  // The public reply link did not move.
  assert.ok(existsSync("app/[locale]/(hive)/reply/[token]/page.tsx"));
  assert.ok(!redirects.some((r) => r.source.includes("/reply")));
});

test("HR tickets: no user-facing English copy says HIVE", () => {
  const en = readFileSync("messages/en.json", "utf8");
  assert.ok(!/:\s*"[^"]*\bHIVE\b/.test(en), "an English message still says HIVE");
});
