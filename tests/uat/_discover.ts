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

// --- Locale config (read from project.config.json, the single source) -------
// The UAT runner builds locale-prefixed URLs, so it must use the SAME locales
// the app ships — not a hardcoded "en". Read via fs (no @/ alias / JSON-import
// dependency on the test bundler) so this stays robust across runners.
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

function readLocaleConfig(): { locales: string[]; defaultLocale: string } {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "project.config.json"), "utf8"),
    ) as { locales?: unknown; defaultLocale?: unknown };
    const locales =
      Array.isArray(cfg.locales) &&
      cfg.locales.every((l) => typeof l === "string") &&
      cfg.locales.length > 0
        ? (cfg.locales as string[])
        : ["en"];
    const defaultLocale =
      typeof cfg.defaultLocale === "string" && locales.includes(cfg.defaultLocale)
        ? cfg.defaultLocale
        : locales[0];
    return { locales, defaultLocale };
  } catch {
    return { locales: ["en"], defaultLocale: "en" };
  }
}

const localeConfig = readLocaleConfig();

/** Locales this fork ships (e.g. ["en"] or ["en","ar"]). */
export const configuredLocales = localeConfig.locales;
/** The default locale UAT URLs are built from (driven by project.config.json). */
export const defaultLocale = localeConfig.defaultLocale;
/** The first RTL locale configured, if any (drives the optional RTL checks). */
export const rtlLocale = configuredLocales.find((l) => RTL_LOCALES.has(l));
/** True when the fork ships an RTL locale → RTL assertions are meaningful. */
export const rtlEnabled = rtlLocale !== undefined;

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
 * True iff a `page.tsx` is a pure redirect stub (e.g. a back-compat route kept
 * only to forward an old URL: `redirect(\`/${locale}/somewhere\`)`). Such a page
 * is NOT a navigable section — it renders no content and always forwards
 * elsewhere — so the screen/section discovery must not treat it as one (else the
 * permission matrix flags every allowed role as "redirected-away" on a benign
 * forwarder). Heuristic: the file calls `redirect(` from next/navigation and
 * returns no JSX.
 */
function isRedirectOnlyPage(pageFile: string): boolean {
  let src = "";
  try {
    src = fs.readFileSync(pageFile, "utf8");
  } catch {
    return false;
  }
  const callsRedirect = /from\s+["']next\/navigation["']/.test(src) && /\bredirect\s*\(/.test(src);
  // A renderable page returns JSX; a redirect stub has none. Detect any JSX tag.
  const hasJsx = /<[A-Za-z>]/.test(src);
  return callsRedirect && !hasJsx;
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
    const hasPage = entries.some((e) => e.isFile() && e.name === "page.tsx");
    // A redirect-only stub (back-compat URL forwarder) is not a navigable screen.
    const isRedirectStub = hasPage && isRedirectOnlyPage(path.join(dir, "page.tsx"));
    if (hasPage && !isRedirectStub && !segments.some(isSkippedSegment)) {
      const name = segments.length === 0 ? "dashboard" : segments.join("/");
      const urlPath = segments.length === 0 ? `/${locale}` : `/${locale}/${segments.join("/")}`;
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

// --- P2 (Build B): role + per-role section-access discovery -----------------
//
// Everything below is DISCOVERY-DRIVEN. Role names come from the Prisma schema;
// which sections are admin-only comes from the app's OWN sidebar gating. Nothing
// is hardcoded, so a fork that renames roles or gates a different section gets
// the right matrix for free.

/**
 * Parse the `Role` enum out of `prisma/schema.prisma` and return its members in
 * declaration order (e.g. ["ADMIN","VIEWER"]). The first member is the
 * privileged role by convention in this template (ADMIN), but callers should not
 * assume a particular name — use {@link discoverSectionAccess} to learn which
 * sections each role may reach.
 *
 * @param root  Repo root to scan from (default process.cwd()); injectable for tests.
 */
export function discoverRoles(root = process.cwd()): string[] {
  const schemaPath = path.join(root, "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) return [];
  const src = fs.readFileSync(schemaPath, "utf8");

  // Match `enum Role { ... }` and pull the bare identifiers inside the braces.
  const block = src.match(/enum\s+Role\s*\{([^}]*)\}/);
  if (!block) return [];

  const roles: string[] = [];
  for (const rawLine of block[1].split("\n")) {
    // Strip line + trailing comments, then keep a leading bare identifier.
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (m) roles.push(m[1]);
  }
  return roles;
}

export type SectionAccess = { name: string; path: string; adminOnly: boolean };

/**
 * Classify each MAIN section (from {@link discoverMainSections}) as admin-only or
 * all-roles by reading the app's OWN nav gating in
 * `components/layout/AppSidebar.tsx`:
 *   - Nav items rendered INSIDE the `isAdmin ? [ ... ] : []` block are admin-only.
 *   - The recycling-bin item is admin-gated via a trailing `.filter(... isAdmin)`,
 *     so it counts as admin-only too.
 *   - Everything else is all-roles.
 *
 * We map a nav item to a section by matching the section's last URL segment
 * against the item's `router.push("/${locale}/<segment>")` target (or the bare
 * `router.push("/${locale}")` for the home/dashboard root). A section with no
 * matching nav entry defaults to all-roles (it isn't admin-gated in the sidebar).
 *
 * This derives the *expected* access from the app's gating, never a hardcoded list.
 *
 * @param locale  URL locale prefix (default "en").
 * @param root    Repo root to scan from (default process.cwd()); injectable for tests.
 */
export function discoverSectionAccess(locale = "en", root = process.cwd()): SectionAccess[] {
  const sections = discoverMainSections(locale, root);
  const sidebarPath = path.join(root, "components", "layout", "AppSidebar.tsx");
  const src = fs.existsSync(sidebarPath) ? fs.readFileSync(sidebarPath, "utf8") : "";

  // 1) Collect the route segments that live INSIDE the `isAdmin ? [ ... ] : []`
  //    block — those nav items are admin-only.
  const adminSegments = new Set<string>();
  const adminBlock = src.match(/isAdmin\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[\]/);
  if (adminBlock) {
    for (const m of adminBlock[1].matchAll(/router\.push\(`\/\$\{locale\}\/([A-Za-z0-9_-]+)`\)/g)) {
      adminSegments.add(m[1]);
    }
  }

  // 2) Any nav item whose key/route is removed unless isAdmin via a trailing
  //    `.filter(... isAdmin)` is also admin-gated. The template does this for
  //    recycling-bin: `.filter((item) => item.key !== "recycling-bin" || isAdmin)`.
  for (const m of src.matchAll(/item\.key\s*!==\s*"([A-Za-z0-9_-]+)"\s*\|\|\s*isAdmin/g)) {
    adminSegments.add(m[1]);
  }

  return sections.map((s) => {
    // The section's matching nav segment is its last URL path segment; the
    // dashboard root (depth 0) has no segment and is never admin-gated.
    const segment = s.name === "dashboard" ? "" : (s.name.split("/").pop() ?? "");
    const adminOnly = segment !== "" && adminSegments.has(segment);
    return { name: s.name, path: s.path, adminOnly };
  });
}

// --- P3 (Build C): CRUD-entity discovery -------------------------------------
//
// Still DISCOVERY-DRIVEN. A "CRUD entity" is any top-level dashboard section
// that the scaffold gave BOTH a create form (`<entity>/new/page.tsx`) AND a
// record/edit page (`<entity>/[id]/page.tsx`). That's the scaffold's signature
// for "this entity has the full create→edit→delete loop," so we can drive the
// journey without anyone naming the entity. A fork that scaffolds `projects`
// gets a `projects` CRUD journey for free; one that only has read-only sections
// yields no journeys (and P3 records that, rather than failing).

export type CrudEntity = {
  name: string; // top-level segment, e.g. "users"
  listPath: string; // "/<locale>/users"
  createPath: string; // "/<locale>/users/new"
};

/**
 * Is this page file a pure `redirect()` stub rather than a real screen?
 *
 * A moved route leaves stubs behind on purpose — ADR-070 kept `/users/new` and
 * `/users/[id]` so bookmarks, the command palette's history and any link in a
 * handover document survive the move to `/admin/access`. Filesystem discovery
 * cannot tell those apart from a real create form, and the difference matters:
 * the CRUD journey navigates to `<entity>/new`, submits, and then asserts it
 * landed back on `<entity>` — but a stub's redirect target navigates somewhere
 * else entirely on success, so the journey times out and reports a FAILURE on a
 * feature that works correctly.
 *
 * That failure mode is worse than a missing journey: it is a false regression on
 * an unrelated feature, and a suite that cries wolf is one the operator learns to
 * skim past — which is how a real regression gets waved through.
 *
 * The test is deliberately narrow: the module must call `redirect(` and must not
 * render anything (no JSX, no `<form`). A page that redirects CONDITIONALLY and
 * otherwise renders a form is still a real screen and stays discovered.
 */
function isRedirectStub(file: string): boolean {
  let src: string;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    return false; // Unreadable: assume it is real, so we under-skip rather than over-skip.
  }
  if (!/\bredirect\s*\(/.test(src)) return false;
  // Any JSX at all means it renders. `return <X/>`, `=> (<X/>)`, `<form`, etc.
  return !/<[A-Za-z][\w.]*[\s/>]/.test(src);
}

export function discoverCrudEntities(locale = "en", root = process.cwd()): CrudEntity[] {
  const base = path.join(root, DASHBOARD_GLOB);
  if (!fs.existsSync(base)) return [];

  const entities: CrudEntity[] = [];

  /** Does `dir` have a real (non-stub) create form AND a real record page? */
  function isCrudDir(dir: string): boolean {
    const createFile = path.join(dir, "new", "page.tsx");
    // A create page that only redirects is not a create page — see isRedirectStub.
    if (!fs.existsSync(createFile) || isRedirectStub(createFile)) return false;
    // The record/edit page lives under a dynamic segment ([id], [slug], ...).
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
      if (!e.isDirectory() || !isDynamicSegment(e.name)) return false;
      const f = path.join(dir, e.name, "page.tsx");
      return fs.existsSync(f) && !isRedirectStub(f);
    });
  }

  function add(segments: string[]) {
    const route = segments.join("/");
    entities.push({
      name: route,
      listPath: `/${locale}/${route}`,
      createPath: `/${locale}/${route}/new`,
    });
  }

  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const seg = entry.name;
    // Top-level real segments only — skip route groups and dynamic folders.
    if (isRouteGroup(seg) || isDynamicSegment(seg)) continue;

    const dir = path.join(base, seg);
    if (isCrudDir(dir)) {
      add([seg]);
      continue;
    }

    // ONE level of nesting, because entities do not always live at the root.
    // ADR-070 moved the account CRUD from `/users` to `/admin/access`, and a
    // root-only scan then found NOTHING — silently dropping a journey that had
    // existed, which is the failure mode this whole module is written against
    // ("a fork that scaffolds `projects` gets a `projects` journey for free").
    // Losing coverage quietly is worse than never having had it, so the scan
    // follows a non-CRUD segment down one level.
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      if (isRouteGroup(child.name) || isDynamicSegment(child.name) || child.name === "new")
        continue;
      if (isCrudDir(path.join(dir, child.name))) add([seg, child.name]);
    }
  }

  entities.sort((a, b) => a.name.localeCompare(b.name));
  return entities;
}
