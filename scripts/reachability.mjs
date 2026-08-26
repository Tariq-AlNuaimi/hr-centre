#!/usr/bin/env node
// Write-endpoint reachability: can a PERSON reach every write this product has?
//
// WHY THIS EXISTS. The 2026-08-25 red team found eleven write endpoints with no
// caller anywhere in the user interface — complete, tested, unreachable logic.
// Nothing caught it, and nothing could have: a contract test imports a route
// module and calls it, so it SUPPLIES the caller whose absence is the defect.
// The conformance report of the day measured "an implementation exists" and let
// that stand in for "a person can do this", which is why it was true as written
// and misleading as read.
//
// This is the second measure, mechanised. For every write verb on every route it
// looks for a client call site using a MATCHING method — a GET caller must not
// make a POST look reachable, which is exactly how F11 hid for weeks.
//
// WHAT IT CANNOT SEE, stated so the number is not read as more than it is:
//   - It matches paths, not behaviour. A call site behind a button nobody can
//     reach, or inside dead code, still counts as a caller here.
//   - Generic CRUD hooks take their path as a VARIABLE (`useEntityMutations(base)`),
//     so those are resolved by following the hook's own base-path argument.
//   - Routes reached other than by `apiClient` (Vercel crons; next-auth's own
//     signIn) are listed with the NAME of their caller, not silently skipped.
// It is a floor, not a proof. The proof is driving the screen in a browser.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// Routes reached by something other than an `apiClient` call. Each needs a reason,
// and the reason has to NAME the caller — "nothing calls it" is the defect this
// script hunts, so an unnamed exemption would be the defect wearing a hat.
//
// Declared entries take precedence over pattern matching: the catch-all below is
// otherwise credited to whichever `/api/auth/...` caller the prefix match reaches
// first, which is a true verdict for a false reason.
const NAMED_CALLER = {
  "/api/internal/audit-purge": "Vercel cron, `crons` in vercel.json (0 3 * * *)",
  "/api/internal/cycle-sweep": "Vercel cron, `crons` in vercel.json (0 6 * * *)",
  "/api/auth/[...nextauth]":
    "next-auth's own signIn()/signOut() — app/[locale]/(auth)/login/LoginForm.tsx",
};

const WRITE = ["POST", "PUT", "PATCH", "DELETE"];
const routes = walk("app/api").filter((p) => p.endsWith("route.ts"));
const callerFiles = [
  ...walk("app"),
  ...walk("components"),
  ...walk("hooks"),
  ...walk("lib"),
].filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith("route.ts"));

// Direct write calls with a literal path.
const calls = [];
// Generic-hook usages: useEntityMutations("/api/x") gives POST /api/x,
// PUT /api/x/:id and DELETE /api/x/:id via hooks/use-entity-queries.ts.
for (const f of callerFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(
    /apiClient\.(post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*[`"']([^`"']*)/g,
  )) {
    calls.push({ method: m[1].toUpperCase(), path: m[2], file: f, via: "direct" });
  }
  for (const m of src.matchAll(
    /fetch\(\s*[`"']([^`"']*)[\s\S]*?method:\s*["'](POST|PUT|PATCH|DELETE)["']/g,
  )) {
    calls.push({ method: m[2], path: m[1], file: f, via: "fetch" });
  }
  for (const m of src.matchAll(/useEntityMutations\s*(?:<[^>]*>)?\s*\(\s*[`"']([^`"']*)/g)) {
    for (const v of ["POST", "PUT", "DELETE"]) {
      calls.push({ method: v, path: m[1], file: f, via: "useEntityMutations" });
    }
  }
}

const rows = [];
for (const r of routes) {
  const src = readFileSync(r, "utf8");
  const apiPath = "/" + r.replace(/^app\//, "").replace(/\/route\.ts$/, "");
  const segs = apiPath.split("/").filter(Boolean);
  const firstDyn = segs.findIndex((s) => s.startsWith("["));
  const head = "/" + (firstDyn === -1 ? segs : segs.slice(0, firstDyn)).join("/");
  const tailSegs = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].startsWith("[")) break;
    tailSegs.unshift(segs[i]);
  }
  const tail = tailSegs.join("/");
  const hasDynamic = firstDyn !== -1;

  for (const v of WRITE) {
    // BOTH declaration forms. Matching only `export const` made the checker blind
    // to `export async function POST` — three auth routes, invisible to a script
    // whose headline number is "0 unreachable". They each turned out to have a
    // caller, so the verdict held; the instrument did not. A checker that cannot
    // see a handler cannot report it missing.
    if (!new RegExp(`export (?:const|async function) ${v}\\b`).test(src)) continue;
    let hits = calls.filter((c) => {
      if (c.method !== v) return false;
      // A literal tail after a dynamic segment is the most specific signal.
      if (tail && hasDynamic) return c.path.includes(tail);
      if (hasDynamic) return c.path.startsWith(head);
      // No dynamic segment: the call must be for THIS path, not a child of it.
      return c.path === apiPath || c.path.startsWith(apiPath + "?");
    });
    // Prefer a real screen over lib/ (api-client's own doc comment lives there).
    hits = hits.sort(
      (a, b) => Number(a.file.startsWith("lib/")) - Number(b.file.startsWith("lib/")),
    );
    const allow = NAMED_CALLER[apiPath];
    rows.push({ apiPath, verb: v, hits: allow ? [] : hits, allow });
  }
}

rows.sort((a, b) => (a.apiPath + a.verb).localeCompare(b.apiPath + b.verb));
const unreachable = rows.filter((r) => !r.hits.length && !r.allow);
const allowed = rows.filter((r) => !r.hits.length && r.allow);

for (const r of rows) {
  if (r.hits.length) {
    const h = r.hits[0];
    console.log(
      `  ok  ${r.verb.padEnd(6)} ${r.apiPath.padEnd(56)} ${h.file}${h.via === "direct" ? "" : `  (${h.via})`}`,
    );
  } else if (r.allow) {
    console.log(
      `  --  ${r.verb.padEnd(6)} ${r.apiPath.padEnd(56)} caller named explicitly: ${r.allow}`,
    );
  } else {
    console.log(`UNREACHABLE ${r.verb} ${r.apiPath}`);
  }
}

console.log(
  `\n${rows.length} (route, verb) pairs · ${rows.length - unreachable.length - allowed.length} with a UI caller` +
    ` · ${allowed.length} with an explicitly named non-apiClient caller · ${unreachable.length} UNREACHABLE`,
);
if (unreachable.length) {
  console.log(
    "\nA write nobody can reach is a feature that does not exist (red-team F1–F6, F11–F13):",
  );
  for (const u of unreachable) console.log(`   ${u.verb} ${u.apiPath}`);
  process.exit(1);
}
