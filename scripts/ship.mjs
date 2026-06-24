#!/usr/bin/env node
/**
 * /ship orchestrator -- the 7-step pre-push gate, optimized for wall time.
 *
 * Mirrors .claude/skills/ship/SKILL.md exactly:
 *   phase A (parallel): 1 typecheck · 2 lint · 3 contract tests · 4 component tests
 *   phase B (serial):   5 build · 6 gitleaks · 7 npm audit
 *
 * Semantics preserved from the skill:
 *   - any phase-A failure blocks phase B (stop the line);
 *   - missing gitleaks is a FAILURE with install instructions, never a skip;
 *   - tsc cache + eslint cache make warm re-runs cheap; caches live under
 *     node_modules/.cache so a fresh clone (and CI) always runs cold;
 *   - the stale-.next/types trap (TS2307 after route deletions) is auto-healed:
 *     clear .next and retry typecheck once.
 *
 * Usage: npm run ship
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";

const CACHE = "node_modules/.cache";

// -- scalability pillar gate (CLAUDE.md "Five Pillars") ----------------------
// A list/read route that calls findMany WITHOUT a bound (take / skip / cursor /
// parsePagination) loads the whole table -- the failure that only surfaces at
// volume. Block it at ship time, the same way a security rule blocks. Escape
// hatch for a table that's genuinely bounded by domain: an inline
// `// pillar:scalable-ok: <reason>` in the file + a docs/findings-register.md line.
function walkRoutes(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    let stat;
    try { stat = statSync(p); } catch { continue; } // skip broken symlinks etc.
    if (stat.isDirectory()) walkRoutes(p, acc);
    else if (p.endsWith("route.ts")) acc.push(p);
  }
  return acc;
}
function scanScalability() {
  const t0 = Date.now();
  // Bound tokens are checked against the ARGUMENT BLOCK of each findMany call
  // (the ~250 chars after `.findMany(`), NOT the whole file -- otherwise the words
  // "take"/"skip" in an unrelated comment would mask a genuinely unbounded call.
  const BOUND = /\btake\b|\bskip\b|\bcursor\b|parsePagination|paginat/;
  const ESCAPE = /pillar:scalable-ok/; // explicit per-file waiver (+ register line)
  const offenders = [];
  for (const file of walkRoutes("app/api")) {
    let src;
    try { src = readFileSync(file, "utf8"); } catch { continue; }
    if (ESCAPE.test(src)) continue;
    const parts = src.split(".findMany(");
    // parts[0] is the text before the first call; each later part begins with a
    // call's arguments. An unbounded arg block = an offending file.
    const unbounded = parts.slice(1).some((after) => !BOUND.test(after.slice(0, 250)));
    if (unbounded) offenders.push(file);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (offenders.length === 0) return { name: "scalability", ok: true, out: "clean", secs };
  return {
    name: "scalability",
    ok: false,
    secs,
    out:
      "Unbounded findMany (no take/skip/cursor/parsePagination) -- loads the whole table at volume (Five Pillars: Scalable):\n" +
      offenders.map((f) => `  - ${f}`).join("\n") +
      "\n  Fix: paginate via lib/pagination.ts (parsePagination/paginatedResponse).\n" +
      "  Or, if the table is bounded by domain: inline `// pillar:scalable-ok: <reason>` + a docs/findings-register.md line.",
  };
}

// -- env: load .env for DATABASE_URL etc. (Prisma 7 does not auto-load it) --
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function run(name, cmd, args, env = {}) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      shell: false,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ name, ok: false, out: String(err), secs: 0 }));
    child.on("close", (code) =>
      resolve({ name, ok: code === 0, out, secs: ((Date.now() - t0) / 1000).toFixed(1) })
    );
  });
}

const report = (r) => console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.secs}s)`);

// -- npm-audit evaluation with a scoped allowlist (audit-allowlist.json) -----
// `npm audit --json` lists EVERY severity; we keep the old `--audit-level=high`
// semantics by only counting High/Critical advisories, then drop any whose GHSA
// id is allowlisted (an upstream-unfixed, triaged-not-reachable advisory with a
// SECURITY.md §12/§13 row). A High+ advisory NOT in the allowlist still fails.
function loadAuditAllowlist() {
  if (!existsSync("audit-allowlist.json")) return new Set();
  try {
    const j = JSON.parse(readFileSync("audit-allowlist.json", "utf8"));
    const advisories = Array.isArray(j.advisories) ? j.advisories : [];
    return new Set(advisories.map((a) => a.id));
  } catch (err) {
    // Safe-fail: an empty allowlist makes every High+ advisory fail /ship. Warn
    // loudly so the cause is the malformed file, not a confusing "new advisory".
    console.warn(
      `  warn: audit-allowlist.json is malformed -- treating as empty (every High+ advisory will fail /ship): ${err.message}`
    );
    return new Set();
  }
}

function evaluateAudit(out) {
  let j;
  try {
    j = JSON.parse(out);
  } catch {
    return { ok: false, out: `npm audit did not return JSON (registry/network error?):\n${out.slice(0, 800)}` };
  }
  // A successful `npm audit --json` always carries `vulnerabilities` + `metadata`.
  // A registry/network failure returns `{ "error": {...} }` (valid JSON, no vuln
  // map) -- without this guard that would read as zero offenders => false green.
  if (j.error || !j.metadata || !j.vulnerabilities) {
    return { ok: false, out: `npm audit did not complete (no results):\n${out.slice(0, 800)}` };
  }
  const allow = loadAuditAllowlist();
  const offenders = new Map(); // GHSA id -> { title, severity }
  for (const v of Object.values(j.vulnerabilities || {})) {
    for (const via of v.via || []) {
      if (typeof via !== "object" || !via.url) continue;
      if (via.severity !== "high" && via.severity !== "critical") continue;
      const m = String(via.url).match(/GHSA-[0-9a-z-]+/i);
      const id = m ? m[0] : via.url;
      if (!allow.has(id)) offenders.set(id, { title: via.title, severity: via.severity });
    }
  }
  if (offenders.size === 0) {
    return { ok: true, out: allow.size ? `clean (allowlisted: ${[...allow].join(", ")})` : "clean" };
  }
  const lines = [...offenders.entries()].map(([id, x]) => `  - ${id} (${x.severity}) ${x.title || ""}`);
  return {
    ok: false,
    out:
      `npm audit found High+ advisories NOT in audit-allowlist.json:\n${lines.join("\n")}\n` +
      `If unfixable + not reachable, add to audit-allowlist.json with a SECURITY.md §12/§13 row.`,
  };
}
const fail = (r) => {
  console.error(`\nship: RED -- ${r.name} failed. First 20 lines:\n`);
  console.error(r.out.split("\n").slice(0, 20).join("\n"));
  process.exit(1);
};

const t0 = Date.now();
console.log("ship: phase A (typecheck | lint | contract tests | component tests | scalability) ...");

// Synchronous, sub-millisecond static gate -- runs alongside phase A.
const scalability = scanScalability();

const typecheck = () =>
  run("typecheck", "npx", ["tsc", "--noEmit", "--tsBuildInfoFile", `${CACHE}/ship.tsbuildinfo`]);

let [tsc, lint, contract, components] = await Promise.all([
  typecheck(),
  // NOTE: ESLint's --cache keys on the LINTED file's content + the config file
  // hash, NOT on the source of imported rule plugins. After editing a rule under
  // eslint-rules/, clear `node_modules/.cache/eslint/` or the cache can serve a
  // STALE result (a fixed rule looks green; a newly-strict rule looks clean).
  run("lint", "npx", ["eslint", "--cache", "--cache-location", `${CACHE}/eslint/`]),
  run("contract tests", "npm", ["test"]),
  run("component tests", "npm", ["run", "test:components"]),
]);

// stale .next/types trap: TS2307 pointing into .next means the build cache is
// from a tree with routes that no longer exist -- clear and retry once.
if (!tsc.ok && /TS2307/.test(tsc.out) && /\.next\/types/.test(tsc.out + " ") ) {
  console.log("  typecheck hit the stale-.next/types trap; clearing .next and retrying ...");
  rmSync(".next", { recursive: true, force: true });
  tsc = await typecheck();
}

for (const r of [tsc, lint, contract, components, scalability]) report(r);
const redA = [tsc, lint, contract, components, scalability].find((r) => !r.ok);
if (redA) fail(redA);

console.log("ship: phase B (build -> gitleaks -> npm audit) ...");

const build = await run("build", "npm", ["run", "build"], { NODE_ENV: "production" });
report(build);
if (!build.ok) fail(build);

const gitleaks = await run("gitleaks", "gitleaks", ["detect", "--no-banner", "--redact"]);
if (!gitleaks.ok && /ENOENT/.test(gitleaks.out)) {
  gitleaks.out =
    "gitleaks is not on PATH -- ship is NOT green until it runs.\n" +
    "  macOS: brew install gitleaks\n" +
    "  Linux: download from https://github.com/gitleaks/gitleaks/releases and put it on PATH";
}
report(gitleaks);
if (!gitleaks.ok) fail(gitleaks);

const auditRaw = await run("npm audit", "npm", ["audit", "--json", "--audit-level=high", "--omit=dev"]);
const audit = { name: "npm audit", secs: auditRaw.secs, ...evaluateAudit(auditRaw.out) };
report(audit);
if (!audit.ok) fail(audit);
if (audit.out.startsWith("clean (allowlisted")) console.log(`  note: npm audit ${audit.out}`);

console.log(
  `\nship: green -- typecheck + lint + tests + component tests + scalability + build + gitleaks + npm audit all pass (${((Date.now() - t0) / 1000).toFixed(0)}s total)`
);
