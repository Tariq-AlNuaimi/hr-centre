import fs from "node:fs";
import path from "node:path";

// Runtime route discovery for UAT. Scans the dashboard route tree on disk and
// returns the navigable screens — so the lean smoke auto-covers any scaffolded
// entity without anyone editing a hardcoded list.
//
// Rules:
//   - Root group page (.../(dashboard)/page.tsx) -> the dashboard at "/<locale>".
//   - Static nested segments -> "/<locale>/<segments...>" (e.g. settings/profile).
//   - SKIP dynamic segments:  [id], [slug], [...all]  (need a real record).
//   - SKIP "new" create-form folders (no record to load; covered by CRUD journeys).
//   - SKIP route groups "(auth)", "(dashboard)", etc. — they don't add a URL segment.
//
// The result feeds smoke.uat.ts. Future Full-mode phases (CRUD journeys) handle
// the dynamic + "new" routes that this intentionally skips.

export type Screen = { name: string; path: string; depth: number };

const DASHBOARD_GLOB = path.join("app", "[locale]", "(dashboard)");

function isDynamicSegment(seg: string): boolean {
  return seg.startsWith("[");
}

function isRouteGroup(seg: string): boolean {
  return seg.startsWith("(") && seg.endsWith(")");
}

function isSkippedSegment(seg: string): boolean {
  return isDynamicSegment(seg) || seg === "new";
}

/**
 * Discover ALL navigable dashboard screens (every static nested route) for a
 * locale. Used by FULL mode (deep journey). Lean uses {@link discoverMainSections}.
 *
 * @param locale  URL locale prefix (default "en").
 * @param root    Repo root to scan from (default process.cwd()); injectable for tests.
 */
export function discoverAllScreens(locale = "en", root = process.cwd()): Screen[] {
  const base = path.join(root, DASHBOARD_GLOB);
  if (!fs.existsSync(base)) return [];

  const screens: Screen[] = [];

  // Walk the tree; `segments` is the URL path built so far (route groups stripped).
  const walk = (dir: string, segments: string[]): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // A page.tsx in this folder makes it a navigable screen — unless one of its
    // URL segments is dynamic or a skipped folder ("new").
    const hasPage = entries.some(
      (e) => e.isFile() && e.name === "page.tsx",
    );
    if (hasPage && !segments.some(isSkippedSegment)) {
      const name = segments.length === 0 ? "dashboard" : segments.join("/");
      const urlPath =
        segments.length === 0 ? `/${locale}` : `/${locale}/${segments.join("/")}`;
      screens.push({ name, path: urlPath, depth: segments.length });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const seg = entry.name;
      // Recurse into route groups WITHOUT adding a URL segment.
      if (isRouteGroup(seg)) {
        walk(path.join(dir, seg), segments);
        continue;
      }
      walk(path.join(dir, seg), [...segments, seg]);
    }
  };

  walk(base, []);

  // Stable order: dashboard first, then alphabetical by path.
  screens.sort((a, b) => {
    if (a.name === "dashboard") return -1;
    if (b.name === "dashboard") return 1;
    return a.path.localeCompare(b.path);
  });

  return screens;
}

/**
 * Discover the MAIN sections only — the top-level nav (the dashboard root + its
 * direct children, depth <= 1). This is the LEAN breadth pass: "explore the main
 * sections," not every sub-page. Sub-routes (e.g. settings/profile), create
 * forms, and record pages are FULL mode's job. Fully discovered, never hardcoded.
 */
export function discoverMainSections(locale = "en", root = process.cwd()): Screen[] {
  return discoverAllScreens(locale, root).filter((s) => s.depth <= 1);
}
