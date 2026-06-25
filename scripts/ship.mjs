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
import { spawn, execSync } from "node:child_process";
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

// -- pillar wave-off gate (CLAUDE.md "Five Pillars") ------------------------
// A pillar concern the operator chooses not to fix is a WAVE-OFF logged in
// docs/findings-register.md, and it must be ADJUDICATED (accepted/scheduled) or
// fixed before /ship goes green -- "acceptable" is a recorded decision, not a
// silent shrug (complaint #12). An entry is OPEN until then. Block on any open
// wave-off, the same way a security or scalability finding blocks.
//
// Matches only real entries: a line beginning with a dash + an ISO date and
// carrying `status: open`. The format-documentation line ("- Format: `YYYY-MM-DD
// ... status: open | adjudicated(...)`") is NOT matched -- its date is the literal
// "YYYY-MM-DD" (no digits) and its "open" is immediately followed by " |".
function scanWaveOffs() {
  const t0 = Date.now();
  const file = "docs/findings-register.md";
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  if (!existsSync(file)) return { name: "wave-offs", ok: true, out: "no register", secs: secs() };
  let src;
  try { src = readFileSync(file, "utf8"); } catch { return { name: "wave-offs", ok: true, out: "unreadable register (skipped)", secs: secs() }; }
  const OPEN = /^-\s*\d{4}-\d{2}-\d{2}\b.*\bstatus:\s*open\b(?!\s*\|)/i;
  const open = src.split("\n").filter((l) => OPEN.test(l)).map((l) => l.trim());
  if (open.length === 0) return { name: "wave-offs", ok: true, out: "clean (no open wave-offs)", secs: secs() };
  return {
    name: "wave-offs",
    ok: false,
    secs: secs(),
    out:
      `${open.length} OPEN pillar wave-off(s) in ${file} — adjudicate (accept/schedule) or fix before green (Five Pillars):\n` +
      open.map((l) => `  ${l}`).join("\n") +
      `\n  An open wave-off is an un-adjudicated decision. Flip it to status: adjudicated(<date>) or fixed(<commit>).`,
  };
}

// -- tier-vs-reality gate (CLAUDE.md "Project tiers") -----------------------
// `project.config.json` tier defaults to "personal" (never shared with the
// company: no /handoff, no SECURITY.md §9 compliance, no formal findings
// register, no CI activation). When a project has actually grown into a SHARED
// company tool, leaving the default silently skips that ceremony. The concrete,
// low-false-positive signal that a project has outgrown "personal" is a SECOND
// human contributor -- the very line CLAUDE.md already draws for CI activation.
// Bots (Claude's noreply, dependabot, *[bot]) don't count. Escape hatch for a
// genuinely-personal repo that still has >1 human author: set "tierAck":
// "personal" in project.config.json (an explicit, recorded affirmation).
function isBotAuthor(email, name) {
  const e = (email || "").toLowerCase();
  const n = (name || "").toLowerCase();
  return (
    e === "noreply@anthropic.com" ||
    e.startsWith("dependabot") ||
    n.includes("[bot]") ||
    e.includes("[bot]")
  );
}
function scanTier() {
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  const ok = (out) => ({ name: "tier", ok: true, out, secs: secs() });
  if (!existsSync("project.config.json")) return ok("no project.config.json (skipped)");
  let cfg;
  try { cfg = JSON.parse(readFileSync("project.config.json", "utf8")); }
  catch { return ok("project.config.json unparseable (skipped)"); }
  const tier = cfg.tier ?? "personal";
  if (tier !== "personal") return ok(`tier=${tier} (no escalation check needed)`);
  if (cfg.tierAck === "personal") return ok("tier=personal (acknowledged despite contributors)");

  // Count distinct human authors across history.
  let raw = "";
  try {
    // %x09 (tab) as the field separator -- a literal `|` would be parsed by the
    // shell execSync runs under (`/bin/sh -c`) and split the command in two.
    raw = execSync("git log --format=%ae%x09%an", { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch { return ok("no git history (skipped)"); }
  const humans = new Set();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [email, ...rest] = line.split("\t");
    const name = rest.join("\t");
    if (!isBotAuthor(email, name)) humans.add(email.toLowerCase());
  }
  if (humans.size < 2) return ok(`tier=personal, ${humans.size} human contributor(s) — consistent`);
  return {
    name: "tier",
    ok: false,
    secs: secs(),
    out:
      `tier is still "personal" (default) but this repo has ${humans.size} distinct human contributors:\n` +
      [...humans].map((h) => `  - ${h}`).join("\n") +
      `\n  A multi-contributor project is a SHARED tool — "personal" skips /handoff, SECURITY.md §9\n` +
      `  compliance, the formal findings register, and CI activation.\n` +
      `  Fix: set "tier": "shared" in project.config.json (then complete the shared-tier ceremony),\n` +
      `  OR, if it is genuinely still personal, set "tierAck": "personal" to record that choice.`,
  };
}

// -- blueprint structural gate (/blueprint full track) ----------------------
// A real feature should ship its contract: /blueprint writes docs/blueprints/
// <feature>.md BEFORE the code, and /qa, /uat, /manual-uat trace coverage
// against it. To make that structural rather than advisory, /ship looks for a
// NEW FEATURE SURFACE in the diff -- a newly-ADDED API route file or a new
// Prisma migration directory (vs the origin/main merge-base) -- and requires a
// committed blueprint for it.
//
// Deliberately narrow to avoid false positives: it keys on *added* feature
// surface only, never on edits to existing auth/lib/route files (a bug fix,
// refactor, or dependency bump is not a new feature and must not be blocked).
// And it is TIERED: shared (company) projects BLOCK; personal (disposable
// /quickstart) projects only WARN, so the idea-to-URL flow stays unblocked.
// Escape hatches: a docs/blueprints/*.md added in the same change, or
// "blueprintAck": "<reason>" in project.config.json.
function scanBlueprint() {
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  const ok = (out, extra = {}) => ({ name: "blueprint", ok: true, out, secs: secs(), ...extra });
  let base = "";
  try { base = execSync("git merge-base origin/main HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ok("no origin/main base (skipped)"); }
  if (!base) return ok("no diff base (skipped)");
  let names = "";
  try {
    // Added files across committed (base..HEAD) AND the working tree.
    names = execSync(`git diff --name-status --diff-filter=A ${base}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch { return ok("diff failed (skipped)"); }
  const added = names.split("\n").map((l) => l.split("\t")[1]).filter(Boolean);
  const newRoutes = added.filter((p) => /^app\/api\/.*route\.ts$/.test(p));
  const newMigrationDirs = [
    ...new Set(added.filter((p) => /^prisma\/migrations\/.+/.test(p)).map((p) => p.split("/").slice(0, 3).join("/"))),
  ];
  const newBlueprints = added.filter((p) => /^docs\/blueprints\/.+\.md$/.test(p) && !/README\.md$/.test(p));
  const signals = [...newRoutes, ...newMigrationDirs];
  if (signals.length === 0) return ok("no new feature surface in diff");
  if (newBlueprints.length > 0) return ok(`new feature surface + blueprint present (${newBlueprints.join(", ")})`);

  let cfg = {};
  try { cfg = JSON.parse(readFileSync("project.config.json", "utf8")); } catch {}
  if (cfg.blueprintAck) return ok(`new feature surface; blueprint waived: ${cfg.blueprintAck}`);
  const tierVal = cfg.tier ?? "personal";
  const detail =
    `New feature surface with no committed docs/blueprints/*.md in this change:\n` +
    signals.map((s) => `  - ${s}`).join("\n") +
    `\n  A real feature should ship its blueprint contract (/blueprint full track).\n` +
    `  Add docs/blueprints/<feature>.md, or set "blueprintAck": "<reason>" in project.config.json.`;
  if (tierVal === "shared") return { name: "blueprint", ok: false, secs: secs(), out: detail };
  // personal tier: ceremony stays light -- warn, don't block.
  return ok(`new feature surface, no blueprint (personal tier — recommended, not blocking)`, { warn: detail });
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
console.log("ship: phase A (typecheck | lint | contract tests | component tests | scalability | wave-offs | tier | blueprint) ...");

// Synchronous, sub-millisecond static gates -- run alongside phase A.
const scalability = scanScalability();
const waveoffs = scanWaveOffs();
const tier = scanTier();
const blueprint = scanBlueprint();

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

for (const r of [tsc, lint, contract, components, scalability, waveoffs, tier, blueprint]) report(r);
if (blueprint.warn) console.warn(`  note: blueprint —\n${blueprint.warn}`);
const redA = [tsc, lint, contract, components, scalability, waveoffs, tier, blueprint].find((r) => !r.ok);
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
  `\nship: green -- typecheck + lint + tests + component tests + scalability + wave-offs + tier + blueprint + build + gitleaks + npm audit all pass (${((Date.now() - t0) / 1000).toFixed(0)}s total)`
);
