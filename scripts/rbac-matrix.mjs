#!/usr/bin/env node
// rbac-matrix.mjs — Derive the EXPECTED RBAC permission matrix straight from the
// code, so the manual UAT walkthrough (.claude/skills/manual-uat) benchmarks the
// live app against what it ACTUALLY enforces — not a hand-maintained list that
// drifts.
//
// Supports TWO authorization models, auto-detected per fork (nothing about
// roles/routes/capabilities is hardcoded here):
//
//   (a) TIER model (the template default) — the wrapper IS the gate:
//        withAdminAuth  -> ADMIN only
//        withEditorAuth -> ADMIN, EDITOR  (or the WRITE_ROLES set if lib/
//                          api-helpers.ts defines one — see loadWriteRoles)
//        withAuth       -> every authenticated role
//        withApiAuth    -> machine (Bearer; not a session role)       [non-role]
//        withInternalAuth -> machine (shared secret / cron)           [non-role]
//        (no wrapper)   -> PUBLIC — flagged as an anomaly unless allowlisted
//
//   (b) CAPABILITY model (forks like rihal-staffing-suite) — the wrapper names a
//        capability resolved against a role→capability catalog:
//        withCapabilityAuth("<cap>") -> the roles the catalog grants <cap> (+ ADMIN,
//                          always a superuser). The catalog is CANONICAL_PERMISSIONS
//                          in lib/permissions-data.ts (or lib/permissions.ts).
//
//      ⚠ F2 — CANONICAL ≠ LIVE. The capability grants here are the CODE DEFAULTS.
//      Apps with an admin-editable role_permissions table (lib/permissions.ts)
//      let an admin override them at runtime, so the LIVE app can grant more or
//      less than this file says. Treat the capability rows as a STARTING benchmark
//      only: the manual-uat walkthrough MUST reconcile against the live grants
//      (GET the app's admin permissions endpoint as ADMIN, or read the DB) before
//      calling any live-vs-expected difference an escalation. See SKILL.md Step 0.
//
//   2. Sidebar nav — which MAIN sections the app gates to ADMIN (mirrors
//      tests/uat/_discover.ts discoverSectionAccess): items inside the
//      `isAdmin ? [ ... ] : []` block, plus a trailing `.filter(... isAdmin)`.
//
// The roster of roles comes from the `Role` enum in prisma/schema.prisma.
//
// Output: uat-results/rbac-expected.json + a printed table. Pure static analysis,
// no DB or network — runs anywhere. `npm run manual-uat:matrix`.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "uat-results");
const OUT_JSON = path.join(OUT_DIR, "rbac-expected.json");

// Public routes that are SUPPOSED to be unauthenticated. An unwrapped route NOT
// on this list is an anomaly (a route that forgot its auth wrapper).
const PUBLIC_ROUTE_ALLOWLIST = new Set([
  "/api/health",
  "/api/auth/[...nextauth]",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

// The ADMIN role name. Most templates use "ADMIN"; a fork may lower-case its enum
// (e.g. "admin"). Resolved from the role roster so the wrapper mappings + the
// capability superuser rule track the fork's actual spelling.
function adminRole(roles) {
  return roles.find((r) => r.toLowerCase() === "admin") ?? "ADMIN";
}

// --- role roster ------------------------------------------------------------

function discoverRoles() {
  const schemaPath = path.join(ROOT, "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) return [];
  const src = fs.readFileSync(schemaPath, "utf8");
  const block = src.match(/enum\s+Role\s*\{([^}]*)\}/);
  if (!block) return [];
  const roles = [];
  for (const rawLine of block[1].split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    // skip prisma block attributes like `@@map("role")`
    if (m && !line.startsWith("@")) roles.push(m[1]);
  }
  return roles;
}

// --- capability catalog (CAPABILITY model only) -----------------------------
// Parse CANONICAL_PERMISSIONS = [ { key: "x", ..., roles: ["admin", ...] }, ... ]
// from lib/permissions-data.ts (preferred) or lib/permissions.ts. Returns a
// Map<capabilityKey, Role[]> or null when the fork has no catalog (TIER model).
function loadCapabilityCatalog(admin) {
  const candidates = ["lib/permissions-data.ts", "lib/permissions.ts"];
  for (const rel of candidates) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    if (!/CANONICAL_PERMISSIONS/.test(src)) continue;
    const map = new Map();
    // tolerant of field order: capture a key and the nearest following roles array
    const re = /key:\s*["']([^"']+)["'][\s\S]*?roles:\s*\[([^\]]*)\]/g;
    let m;
    while ((m = re.exec(src))) {
      const key = m[1];
      const roles = [...m[2].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
      // ADMIN is always a superuser under withCapabilityAuth, even if omitted.
      map.set(key, Array.from(new Set([admin, ...roles])));
    }
    if (map.size) return { map, source: rel };
  }
  return null;
}

// withEditorAuth admits "write" roles. The template default is ADMIN+EDITOR, but a
// fork may define an explicit WRITE_ROLES set in lib/api-helpers.ts (e.g. every
// role except read-only ones). Use that when present so the matrix is accurate.
function loadWriteRoles() {
  const p = path.join(ROOT, "lib", "api-helpers.ts");
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, "utf8");
  const block = src.match(/WRITE_ROLES[^=]*=\s*new Set<Role>\(\[([\s\S]*?)\]\)/);
  if (!block) return null;
  const roles = [...block[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  return roles.length ? roles : null;
}

// --- API route scan ---------------------------------------------------------

function isRouteGroup(seg) {
  return seg.startsWith("(") && seg.endsWith(")");
}

// Build the URL for an app-router route.ts: strip the leading "app", drop route
// groups "(auth)", keep dynamic segments "[id]" verbatim.
function urlForRouteFile(absFile) {
  const rel = path.relative(path.join(ROOT, "app"), path.dirname(absFile));
  const segs = rel.split(path.sep).filter((s) => s && !isRouteGroup(s));
  return "/" + segs.join("/");
}

function findRouteFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findRouteFiles(full, out);
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out;
}

// All auth wrappers the scanner recognizes, in detection priority. The capability
// wrapper carries an argument (the capability key) captured separately.
const KNOWN_WRAPPERS = [
  "withCapabilityAuth",
  "withAdminAuth",
  "withEditorAuth",
  "withApiAuth",
  "withInternalAuth",
  "withAuth", // last: it is a substring-ish of the others by intent, check it after
];

// For one route file, return [{ method, wrapper, capability, hasRateLimit }] across
// BOTH export styles the template uses:
//   - `export const METHOD = withRateLimit(withAuth(...))` — the wrapper is the
//     FIRST known auth wrapper named in the RHS (rate-limit composes outside).
//   - `export async function METHOD(...) { ... }` — a BARE handler (wrapper=null);
//     a wrapper returns a handler assigned to a const, so a function-style export
//     is inherently unguarded. That is how the genuinely public auth/health routes
//     are written AND how a route that FORGOT its wrapper would look — so it must
//     be visible and (if not allowlisted) flagged, never silently dropped.
function parseRouteHandlers(src) {
  const handlers = [];
  const NEXT_EXPORT = `(?=\\n\\s*export\\s+(?:const|(?:async\\s+)?function)\\s|$)`;
  for (const method of HTTP_METHODS) {
    const constRe = new RegExp(
      `export\\s+const\\s+${method}\\s*=\\s*([\\s\\S]*?)${NEXT_EXPORT}`,
    );
    const m = src.match(constRe);
    if (m) {
      const rhs = m[1];
      const wrapper = KNOWN_WRAPPERS.find((w) => new RegExp(`\\b${w}\\b`).test(rhs)) ?? null;
      let capability = null;
      if (wrapper === "withCapabilityAuth") {
        capability = rhs.match(/withCapabilityAuth\(\s*["']([^"']+)["']/)?.[1] ?? "(dynamic)";
      }
      handlers.push({ method, wrapper, capability, hasRateLimit: /\bwithRateLimit\b/.test(rhs) });
      continue;
    }
    const fnRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`);
    if (fnRe.test(src)) {
      handlers.push({ method, wrapper: null, capability: null, hasRateLimit: false });
    }
  }
  return handlers;
}

function scanApiRoutes(roles, ctx) {
  const { admin, catalog, writeRoles } = ctx;
  const apiDir = path.join(ROOT, "app", "api");
  const routes = [];
  const anomalies = [];
  const editorRoles = writeRoles ?? roles.filter((r) => r === admin || r.toLowerCase() === "editor");

  for (const file of findRouteFiles(apiDir)) {
    const url = urlForRouteFile(file);
    const src = fs.readFileSync(file, "utf8");
    const relFile = path.relative(ROOT, file);
    for (const h of parseRouteHandlers(src)) {
      let allowedRoles = null;
      let kind = "unknown";
      let detail = h.wrapper ?? "(none)";
      let source = null;

      switch (h.wrapper) {
        case "withCapabilityAuth": {
          kind = "capability";
          detail = `cap:${h.capability}`;
          source = "canonical"; // ⚠ F2: reconcile against live role_permissions
          if (catalog && catalog.map.has(h.capability)) {
            allowedRoles = catalog.map.get(h.capability);
          } else if (h.capability === "(dynamic)") {
            anomalies.push({
              type: "dynamic-capability", url, method: h.method, file: relFile,
              detail: `${h.method} ${url} computes its capability at runtime — static matrix can't resolve it; verify live.`,
            });
            allowedRoles = [admin];
          } else {
            anomalies.push({
              type: "unknown-capability", url, method: h.method, file: relFile,
              detail: `${h.method} ${url} gates on capability "${h.capability}" not found in the catalog — typo or stale catalog?`,
            });
            allowedRoles = [admin];
          }
          break;
        }
        case "withAdminAuth":
          kind = "role"; allowedRoles = [admin]; break;
        case "withEditorAuth":
          kind = "role"; allowedRoles = [...editorRoles]; break;
        case "withAuth":
          kind = "role"; allowedRoles = [...roles]; break;
        case "withApiAuth":
        case "withInternalAuth":
          kind = "machine"; break;
        default:
          kind = "public"; detail = "(public)";
          if (!PUBLIC_ROUTE_ALLOWLIST.has(url)) {
            anomalies.push({
              type: "unguarded-route", url, method: h.method, file: relFile,
              detail: `${h.method} ${url} has no recognized auth wrapper and is not on the public allowlist.`,
            });
          }
      }
      routes.push({
        url, method: h.method, wrapper: h.wrapper, kind, capability: h.capability,
        allowedRoles, source, hasRateLimit: h.hasRateLimit, detail, file: relFile,
      });
    }
  }
  routes.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  return { routes, anomalies };
}

// --- sidebar section access (mirrors _discover.ts discoverSectionAccess) -----

const DASHBOARD_GLOB = path.join("app", "[locale]", "(dashboard)");

function discoverMainSections(locale = "en") {
  const base = path.join(ROOT, DASHBOARD_GLOB);
  if (!fs.existsSync(base)) return [];
  const sections = [];
  const walk = (dir, segments, depth) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hasPage = entries.some((e) => e.isFile() && e.name === "page.tsx");
    if (hasPage && depth <= 1 && !segments.some((s) => s.startsWith("[") || s === "new")) {
      const name = segments.length === 0 ? "dashboard" : segments.join("/");
      const url = segments.length === 0 ? `/${locale}` : `/${locale}/${segments.join("/")}`;
      sections.push({ name, path: url });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const seg = entry.name;
      if (isRouteGroup(seg)) walk(path.join(dir, seg), segments, depth);
      else walk(path.join(dir, seg), [...segments, seg], depth + 1);
    }
  };
  walk(base, [], 0);
  return sections;
}

function discoverSectionAccess(roles, admin, locale = "en") {
  const sections = discoverMainSections(locale);
  const sidebarPath = path.join(ROOT, "components", "layout", "AppSidebar.tsx");
  const src = fs.existsSync(sidebarPath) ? fs.readFileSync(sidebarPath, "utf8") : "";

  const adminSegments = new Set();
  const adminBlock = src.match(/isAdmin\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[\]/);
  if (adminBlock) {
    for (const m of adminBlock[1].matchAll(/router\.push\(`\/\$\{locale\}\/([A-Za-z0-9_-]+)`\)/g)) {
      adminSegments.add(m[1]);
    }
  }
  for (const m of src.matchAll(/item\.key\s*!==\s*"([A-Za-z0-9_-]+)"\s*\|\|\s*isAdmin/g)) {
    adminSegments.add(m[1]);
  }

  return sections.map((s) => {
    const segment = s.name === "dashboard" ? "" : s.name.split("/").pop() ?? "";
    const adminOnly = segment !== "" && adminSegments.has(segment);
    return {
      name: s.name,
      path: s.path,
      adminOnly,
      allowedRoles: adminOnly ? [admin] : [...roles],
    };
  });
}

// --- render -----------------------------------------------------------------

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
// keep role column headers narrow for capability forks with many long role names
function shortRole(r) {
  return r.length <= 6 ? r : r.replace(/_/g, "").slice(0, 6);
}

function printMatrix(model) {
  const { roles, sections, routes, anomalies, modelKind, catalogSource } = model;
  const w = roles.length > 4 ? 7 : 8;
  console.log(`\nRBAC EXPECTED MATRIX (${modelKind} model, derived from code)\n` + "=".repeat(72));
  console.log(`Roles: ${roles.join(", ") || "(none found)"}`);
  if (modelKind === "capability") {
    console.log(`Capability catalog: ${catalogSource}`);
    console.log("⚠  Capability grants below are CANONICAL defaults — reconcile against the");
    console.log("   LIVE role_permissions before judging escalations (SKILL.md Step 0 / F2).");
  }
  console.log("");

  console.log("UI SECTIONS (sidebar gating)");
  console.log(pad("section", 22) + roles.map((r) => pad(shortRole(r), w)).join(""));
  for (const s of sections) {
    const cells = roles.map((r) => pad(s.allowedRoles.includes(r) ? "✓" : "·", w)).join("");
    console.log(pad(s.name, 22) + cells);
  }

  console.log("\nAPI ROUTES (auth wrapper gating)");
  console.log(pad("method route", 40) + pad("gate", 22) + roles.map((r) => pad(shortRole(r), w)).join(""));
  for (const rt of routes) {
    const label = `${rt.method} ${rt.url}`;
    const cells =
      rt.allowedRoles === null
        ? pad(rt.kind === "machine" ? "machine-only" : "—", roles.length * w)
        : roles.map((r) => pad(rt.allowedRoles.includes(r) ? "✓" : "·", w)).join("");
    console.log(pad(label.length > 39 ? label.slice(0, 38) + "…" : label, 40) + pad(rt.detail, 22) + cells);
  }

  if (anomalies.length) {
    console.log("\n⚠  ANOMALIES (" + anomalies.length + ")");
    for (const a of anomalies) console.log(`  - [${a.type}] ${a.detail}`);
  } else {
    console.log("\n✓ No route anomalies.");
  }
  console.log("");
}

function main() {
  const roles = discoverRoles();
  const admin = adminRole(roles);
  const catalog = loadCapabilityCatalog(admin);
  const writeRoles = loadWriteRoles();
  const sections = discoverSectionAccess(roles, admin);
  const { routes, anomalies } = scanApiRoutes(roles, { admin, catalog, writeRoles });
  const usesCapability = routes.some((r) => r.wrapper === "withCapabilityAuth");
  const modelKind = usesCapability ? "capability" : "tier";

  const model = {
    generatedAt: new Date().toISOString(),
    modelKind,
    catalogSource: catalog?.source ?? null,
    admin,
    roles,
    sections,
    routes,
    anomalies,
    // ⚠ F2: for the capability model, `routes[].allowedRoles` is the CANONICAL
    // default. The live app may override it via an admin-editable permissions
    // table; the manual-uat walkthrough must reconcile against live grants.
    canonicalOnly: modelKind === "capability",
    legend: {
      withAdminAuth: `${admin} only`,
      withEditorAuth: writeRoles ? `WRITE_ROLES: ${writeRoles.join(", ")}` : `${admin}, EDITOR`,
      withAuth: "any authenticated role",
      withCapabilityAuth: "roles the capability catalog grants (+ admin) — CANONICAL, reconcile vs live",
      withApiAuth: "machine (Bearer) — not a session role",
      withInternalAuth: "machine (shared secret / cron) — not a session role",
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2) + "\n");

  printMatrix(model);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)}`);
  // Informational by default (the manual-uat walk consumes the JSON). Pass
  // --strict to make unguarded-route anomalies a hard failure — use that form if
  // this is ever wired into a gate (/ship, CI) so real anomalies can't go green.
  const hard = anomalies.filter((a) => a.type === "unguarded-route");
  if (hard.length && process.argv.includes("--strict")) process.exitCode = 1;
}

main();
