// Contract: real HTTP status codes for refused and missing screens
// (docs/blueprints/limits.md slice 3, ADR-101).
//
// A screen that draws "You do not have access" or "Not found" inside an HTTP 200
// lies to every crawler, monitor and browser history. This suite SWEEPS every
// dashboard page:
//
//   1. PLACEMENT — a `notFound()` (directly, or through requireSection /
//      requireRecord) only sets the status if nothing has streamed yet, so no
//      gating page may sit under a loading.tsx, and no gating layout under a
//      loading.tsx of an ANCESTOR segment (its own segment's boundary wraps its
//      children, not the layout).
//   2. REFUSALS — every page whose component tree draws an access refusal is
//      behind a section gate placed as in (1).
//   3. RECORDS — every detail page (a `[param]` segment) is behind a record gate
//      (or a `notFound()`) placed as in (1).
//
// The gate predicates themselves are unit-tested at the end against the same
// NavContext the sidebar builds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { NavContext } from "../../lib/nav/config";
import type { Grants } from "../../lib/rbac/grants";

const ROOT = resolve(new URL("../../", import.meta.url).pathname);
const DASH = join(ROOT, "app/[locale]/(dashboard)");

function walk(dir: string, name: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, name, out);
    else if (n === name) out.push(p);
  }
  return out;
}

const pages = walk(DASH, "page.tsx").sort();
const layouts = walk(DASH, "layout.tsx").sort();
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => relative(DASH, f);

/** Segment directories from the dashboard root down to `dir` (inclusive). */
function chain(dir: string): string[] {
  const out: string[] = [];
  let d = dir;
  while (d.startsWith(DASH)) {
    out.unshift(d);
    if (d === DASH) break;
    d = dirname(d);
  }
  return out;
}

/** Is there a loading.tsx at or above `dir` (inclusive) / strictly above (exclusive)? */
function boundaryAbove(dir: string, inclusive: boolean): string | null {
  const dirs = chain(dir);
  for (const d of inclusive ? dirs : dirs.slice(0, -1)) {
    if (existsSync(join(d, "loading.tsx"))) return rel(join(d, "loading.tsx"));
  }
  return null;
}

const GATE = /\brequireSection\(|\brequireRecord\(|\bnotFound\(\)/;
const SECTION = /\brequireSection\(/;
const RECORD = /\brequireRecord\(|\bnotFound\(\)/;

/** Does a page, or a layout at/above its segment, gate it (and is that gate placed right)? */
function gatedBy(page: string, kind: RegExp): string[] {
  const dir = dirname(page);
  const out: string[] = [];
  if (kind.test(read(page)) && boundaryAbove(dir, true) === null) out.push(rel(page));
  for (const d of chain(dir)) {
    const layout = join(d, "layout.tsx");
    if (existsSync(layout) && kind.test(read(layout)) && boundaryAbove(d, false) === null) {
      out.push(rel(layout));
    }
  }
  return out;
}

test("the sweep sees the whole dashboard", () => {
  assert.ok(pages.length > 120, `found ${pages.length} pages`);
});

test("PLACEMENT: no gating page sits under a loading boundary", () => {
  const bad = pages
    .filter((p) => GATE.test(read(p)))
    .map((p) => [rel(p), boundaryAbove(dirname(p), true)] as const)
    .filter(([, b]) => b !== null);
  assert.deepEqual(bad, [], "a notFound() here would be sent after a 200 has streamed");
});

test("PLACEMENT: no gating layout sits under an ancestor's loading boundary", () => {
  const bad = layouts
    .filter((l) => GATE.test(read(l)))
    .map((l) => [rel(l), boundaryAbove(dirname(l), false)] as const)
    .filter(([, b]) => b !== null);
  assert.deepEqual(bad, []);
});

// --- refusals ------------------------------------------------------------------

/** What a screen draws when it refuses the viewer. */
const REFUSAL = /<NotPermitted\b|["'](?:[\w.]+\.)?notPermitted["']|["'](?:[\w.]+\.)?noAccess["']/;

/** Generic state components: the refusal is DEFINED here, drawn by their callers. */
const DEFINITIONS = new Set(["components/jml/States.tsx"]);

/**
 * Refusal copy inside a component that is NOT the screen's own refusal: a tab
 * or a chrome element on a page everyone may open. Each with its reason.
 */
const NOT_A_SCREEN_REFUSAL: Record<string, string> = {
  "components/jml/EmployeeJmlTab.tsx": "a tab on the person page, which is record-gated itself",
  "components/layout/OrgSwitcher.tsx": "app chrome, on every page",
};

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Files in a page's local component tree (components/** and app/**), depth-bounded. */
function tree(file: string, depth = 4, seen = new Set<string>()): Set<string> {
  if (seen.has(file) || depth < 0) return seen;
  seen.add(file);
  for (const m of read(file).matchAll(/from\s+["']([^"']+)["']/g)) {
    const r = resolveImport(file, m[1]!);
    if (r && /\/(components|app)\//.test(r)) tree(r, depth - 1, seen);
  }
  return seen;
}

function refusesIn(page: string): string[] {
  return [...tree(page)]
    .map((f) => relative(ROOT, f))
    .filter((f) => !DEFINITIONS.has(f) && !(f in NOT_A_SCREEN_REFUSAL))
    .filter((f) => REFUSAL.test(readFileSync(join(ROOT, f), "utf8")));
}

const refusing = pages.map((p) => [p, refusesIn(p)] as const).filter(([, r]) => r.length > 0);

test("REFUSALS: the sweep finds the screens that refuse (inventory)", () => {
  // The inventory this slice fixed: Performance admin screens, JML, Hiring home,
  // AI settings. If this drops sharply the marker regex has stopped matching.
  assert.ok(refusing.length >= 40, `found ${refusing.length}`);
});

test("REFUSALS: every screen that can draw a refusal is section-gated before it streams", () => {
  const ungated = refusing
    .filter(([p]) => gatedBy(p, SECTION).length === 0)
    .map(([p, r]) => `${rel(p)} (draws a refusal in ${r.join(", ")})`);
  assert.deepEqual(ungated, []);
});

// --- records -------------------------------------------------------------------

/**
 * Detail pages that do not need a record gate, each with its reason. Anything
 * else under a `[param]` segment must answer 404 for a record it cannot show.
 */
const NO_RECORD_GATE: Record<string, string> = {
  "users/[id]/page.tsx": "a permanent redirect to /admin/access/[id], which is gated",
};

test("RECORDS: every detail page answers 404 for a record it cannot show", () => {
  const ungated = pages
    .filter((p) => /\/\[[^/]+\]\//.test(rel(p) + "/") || /\[[^/]+\]/.test(rel(p)))
    .filter((p) => !(rel(p) in NO_RECORD_GATE))
    .filter((p) => gatedBy(p, RECORD).length === 0)
    .map(rel);
  assert.deepEqual(ungated, []);
});

// --- the predicates ------------------------------------------------------------

const ctx = (over: Partial<NavContext> & { perms?: string[] } = {}): NavContext => {
  const perms = new Set(over.perms ?? []);
  const has = (p: string) => perms.has(p);
  return {
    isAdmin: false,
    employeeId: "e1",
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
    jml: has,
    jmlTaskWorker: false,
    hiring: has,
    persona: "employee",
    ...over,
  } as NavContext;
};
const noGrants: Grants = new Map();

test("a plain employee is refused every gated section", async () => {
  const { SECTION_GATES, sectionAllowed } = await import("../../lib/nav/page-gate");
  const allowed = (Object.keys(SECTION_GATES) as Array<keyof typeof SECTION_GATES>).filter((s) =>
    sectionAllowed(s, ctx(), noGrants),
  );
  assert.deepEqual(allowed, []);
});

test("each gate admits the people its screen serves", async () => {
  const { sectionAllowed } = await import("../../lib/nav/page-gate");
  const pms = (p: Partial<NavContext["pms"]>) => ({ ...ctx().pms, ...p });
  assert.equal(sectionAllowed("/admin/cycles", ctx({ pms: pms({ hr: true }) }), noGrants), true);
  assert.equal(
    sectionAllowed("/goal-setting", ctx({ pms: pms({ lineManager: true }) }), noGrants),
    true,
  );
  assert.equal(sectionAllowed("/admin/access", ctx({ isAdmin: true }), noGrants), true);
  assert.equal(sectionAllowed("/audit-log", ctx({ pms: pms({ hr: true }) }), noGrants), false);
  assert.equal(sectionAllowed("/hiring", ctx({ perms: ["hiring.view"] }), noGrants), true);
  assert.equal(
    sectionAllowed("/jml/settings/rules", ctx({ perms: ["jml.view"] }), noGrants),
    false,
  );
  assert.equal(
    sectionAllowed("/jml/settings/statutory", ctx({ perms: ["jml.verifyStatutory"] }), noGrants),
    true,
  );
  assert.equal(sectionAllowed("/jml/my-tasks", ctx({ jmlTaskWorker: true }), noGrants), true);
  // The imports hub follows its route: org-wide jml.configure, not a scoped one.
  const scoped: Grants = new Map([["jml.configure", [{ type: "COMPANY", id: "c1" }]]]);
  const group: Grants = new Map([["jml.configure", [{ type: "GROUP", id: null }]]]);
  assert.equal(sectionAllowed("/admin/imports", ctx(), scoped), false);
  assert.equal(sectionAllowed("/admin/imports", ctx(), group), true);
});

test("every section gate is used by a page or layout (no dead gates)", async () => {
  const { SECTION_GATES } = await import("../../lib/nav/page-gate");
  const used = new Set(
    [...pages, ...layouts].flatMap((f) =>
      [...read(f).matchAll(/requireSection\("([^"]+)"\)/g)].map((m) => m[1]),
    ),
  );
  assert.deepEqual(
    Object.keys(SECTION_GATES).filter((s) => !used.has(s)),
    [],
  );
});
