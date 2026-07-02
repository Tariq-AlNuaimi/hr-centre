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
import { existsSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
  // git merge-base always returns a 40-char hex SHA; validate before interpolating
  // into the diff command so a corrupted repo state can't surprise us.
  if (!/^[0-9a-f]{40}$/.test(base)) return ok("no valid diff base (skipped)");
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

// -- DB-structure gate (ADR-031 "mandatory structured database") -------------
// Directive D5: every app on this rail persists its domain in a structured,
// migrated Postgres schema -- no JSON-file stores, no schema-less shells. Three
// checks:
//   (a) prisma/schema.prisma declares >=1 DOMAIN model beyond the auth/audit
//       baseline (BASELINE_MODELS below);
//   (b) prisma/migrations/ is non-empty (the schema is realized as migrations);
//   (c) migrations <-> schema are in sync (`prisma migrate diff
//       --from-migrations --to-schema`). The diff needs a shadow database
//       (SHADOW_DATABASE_URL: a disposable, EMPTY Postgres DB it replays the
//       migrations into); when none is configured or reachable the check
//       degrades to a clear WARN -- never a false RED. A genuinely out-of-sync
//       schema when the diff CAN run fails red.
// The PRISTINE TEMPLATE is exempt from (a): it deliberately ships baseline-only
// (a fork's first /quickstart scaffolds the first domain model via
// /scaffold-entity). The exemption keys on the pre-/rebrand package name, so
// every rebranded fork is gated. Escape hatch for the rare genuinely stateless
// fork (mirrors tierAck/blueprintAck; ADR-025 pattern; never silent):
// "dbAck": "<reason>" in project.config.json PLUS an adjudicated ADR-031/dbAck
// line in docs/findings-register.md.

// ADR-031 baseline allowlist: the Auth.js models (User/Account/Session/
// VerificationToken) + the audit log (AuditLog). Keep in lockstep with
// prisma/schema.prisma when the auth/audit baseline itself changes (ADR-031
// "migration triggers"); any model NOT in this set counts as a domain model.
const BASELINE_MODELS = new Set(["User", "Account", "Session", "VerificationToken", "AuditLog"]);
// package.json name BEFORE scripts/rebrand.mjs runs -- the pristine-template marker.
const TEMPLATE_PKG_NAME = "fullstack-next-template";

async function checkMigrationsInSync() {
  // Returns { sync: "ok" } | { sync: "skip", why } | { sync: "red", detail }.
  const shadowUrl = process.env.SHADOW_DATABASE_URL;
  if (!shadowUrl) {
    return {
      sync: "skip",
      why: "in-sync check skipped: SHADOW_DATABASE_URL is not set (needs a disposable, EMPTY Postgres DB to replay migrations into). Checks (a)+(b) still enforced.",
    };
  }
  // `prisma migrate diff --from-migrations` reads shadowDatabaseUrl from the
  // Prisma config file, which the repo's prisma.config.ts doesn't set -- emit a
  // minimal throwaway config (reads env at runtime; no secrets baked into the
  // file) and point --config at it.
  const cfgPath = `${CACHE}/ship-db-shadow.config.mjs`;
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(
    cfgPath,
    `export default {\n` +
      `  schema: ${JSON.stringify(resolve("prisma/schema.prisma"))},\n` +
      `  datasource: {\n` +
      `    url: process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused",\n` +
      `    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,\n` +
      `  },\n` +
      `};\n`
  );
  const r = await run("migrate diff", "npx", [
    "prisma", "migrate", "diff",
    "--config", cfgPath,
    "--from-migrations", "prisma/migrations",
    "--to-schema", "prisma/schema.prisma",
    "--exit-code",
  ]);
  if (r.ok) return { sync: "ok" };
  // --exit-code: 0 = no difference, 2 = difference, 1 = error. `run` only
  // exposes ok/out, so tell drift from an unreachable/broken shadow DB by the
  // output: a real diff prints schema-change lines, an error prints "Error:".
  if (/^Error:|P1\d{3}/m.test(r.out)) {
    return {
      sync: "skip",
      why:
        "in-sync check skipped: shadow DB unavailable/errored -- an unreachable DB is a WARN, not a false RED (ADR-031). First lines:\n" +
        r.out.split("\n").filter((l) => l.trim()).slice(0, 5).map((l) => `    ${l}`).join("\n"),
    };
  }
  return {
    sync: "red",
    detail:
      "prisma/migrations is OUT OF SYNC with prisma/schema.prisma (`prisma migrate diff` is non-empty):\n" +
      r.out.split("\n").filter((l) => l.trim()).slice(0, 15).map((l) => `  ${l}`).join("\n") +
      "\n  Fix: `npx prisma migrate dev --name <change>` to realize the schema edit as a migration.",
  };
}

async function scanDbStructure() {
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  const ok = (out, extra = {}) => ({ name: "db-structure", ok: true, out, secs: secs(), ...extra });
  const red = (out) => ({ name: "db-structure", ok: false, out, secs: secs() });

  if (!existsSync("prisma/schema.prisma")) {
    return red(
      "prisma/schema.prisma is missing -- a structured, migrated Postgres schema is mandatory (ADR-031).\n" +
        "  Restore the schema; this rail has no schema-less path."
    );
  }

  // Escape hatch first (mirrors tierAck): explicit, recorded, never silent.
  let cfg = {};
  try { cfg = JSON.parse(readFileSync("project.config.json", "utf8")); } catch {}
  if (cfg.dbAck) {
    const ADJUDICATED = /^-\s*\d{4}-\d{2}-\d{2}\b.*\b(ADR-031|dbAck)\b.*\bstatus:\s*adjudicated/i;
    let reg = "";
    try { reg = readFileSync("docs/findings-register.md", "utf8"); } catch {}
    if (reg.split("\n").some((l) => ADJUDICATED.test(l))) {
      return ok(`db-structure waived: ${cfg.dbAck} (adjudicated ADR-031 line in docs/findings-register.md)`);
    }
    return red(
      `"dbAck" is set in project.config.json but docs/findings-register.md has no ADJUDICATED ADR-031/dbAck line.\n` +
        `  The escape hatch is never silent (ADR-031): add a register line\n` +
        `  \`- YYYY-MM-DD — [maintainable/db] dbAck: <why this fork is stateless> — <owner> — status: adjudicated(<date>)\`\n` +
        `  (the operator adjudicates it), or remove "dbAck" and scaffold a domain model.`
    );
  }

  // (a) >=1 domain model beyond the auth/audit baseline.
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const models = [...schema.matchAll(/^\s*model\s+([A-Za-z_]\w*)\s*\{/gm)].map((m) => m[1]);
  const domain = models.filter((m) => !BASELINE_MODELS.has(m));
  let pkgName = "";
  try { pkgName = JSON.parse(readFileSync("package.json", "utf8")).name ?? ""; } catch {}
  const pristineTemplate = pkgName === TEMPLATE_PKG_NAME;
  if (domain.length === 0 && !pristineTemplate) {
    return red(
      `prisma/schema.prisma has NO domain model beyond the auth/audit baseline (${[...BASELINE_MODELS].join(", ")}) -- ` +
        `a structured DB is mandatory (ADR-031).\n` +
        `  Scaffold the data model: npm run scaffold -- --name <Entity> --fields '<spec>' (/scaffold-entity).\n` +
        `  Rare stateless fork? Set "dbAck": "<reason>" in project.config.json + an adjudicated line in docs/findings-register.md.`
    );
  }

  // (b) migrations are non-empty (>=1 directory carrying a migration.sql).
  let migrations = [];
  try {
    migrations = readdirSync("prisma/migrations").filter((d) => existsSync(`prisma/migrations/${d}/migration.sql`));
  } catch {}
  if (migrations.length === 0) {
    return red(
      "prisma/migrations/ is empty -- the schema is not realized as migrations (ADR-031; `vercel.json` runs `prisma migrate deploy` every build).\n" +
        "  Fix: `npx prisma migrate dev --name init` against a local DB (`make db-up`)."
    );
  }

  // (c) migrations <-> schema in sync (WARN-degrades when no shadow DB).
  const { sync, why, detail } = await checkMigrationsInSync();
  if (sync === "red") return red(detail);
  const summary =
    (pristineTemplate && domain.length === 0
      ? "pristine template (baseline-only schema is intentional; forks are gated)"
      : `${domain.length} domain model(s): ${domain.join(", ")}`) +
    `; ${migrations.length} migration(s); ` +
    (sync === "ok" ? "migrations in sync" : "in-sync check skipped");
  return sync === "skip" ? ok(summary, { warn: why }) : ok(summary);
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
console.log("ship: phase A (typecheck | lint | contract tests | component tests | scalability | wave-offs | tier | blueprint | db-structure) ...");

// Synchronous, sub-millisecond static gates -- run alongside phase A.
const scalability = scanScalability();
const waveoffs = scanWaveOffs();
const tier = scanTier();
const blueprint = scanBlueprint();

const typecheck = () =>
  run("typecheck", "npx", ["tsc", "--noEmit", "--tsBuildInfoFile", `${CACHE}/ship.tsbuildinfo`]);

let [tsc, lint, contract, components, dbStructure] = await Promise.all([
  typecheck(),
  // NOTE: ESLint's --cache keys on the LINTED file's content + the config file
  // hash, NOT on the source of imported rule plugins. After editing a rule under
  // eslint-rules/, clear `node_modules/.cache/eslint/` or the cache can serve a
  // STALE result (a fixed rule looks green; a newly-strict rule looks clean).
  run("lint", "npx", ["eslint", "--cache", "--cache-location", `${CACHE}/eslint/`]),
  run("contract tests", "npm", ["test"]),
  run("component tests", "npm", ["run", "test:components"]),
  scanDbStructure(),
]);

// stale .next/types trap: TS2307 pointing into .next means the build cache is
// from a tree with routes that no longer exist -- clear and retry once.
if (!tsc.ok && /TS2307/.test(tsc.out) && /\.next\/types/.test(tsc.out + " ") ) {
  console.log("  typecheck hit the stale-.next/types trap; clearing .next and retrying ...");
  rmSync(".next", { recursive: true, force: true });
  tsc = await typecheck();
}

for (const r of [tsc, lint, contract, components, scalability, waveoffs, tier, blueprint, dbStructure]) report(r);
if (blueprint.warn) console.warn(`  note: blueprint —\n${blueprint.warn}`);
if (dbStructure.warn) console.warn(`  note: db-structure — ${dbStructure.warn}`);
const redA = [tsc, lint, contract, components, scalability, waveoffs, tier, blueprint, dbStructure].find((r) => !r.ok);
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
  `\nship: green -- typecheck + lint + tests + component tests + scalability + wave-offs + tier + blueprint + db-structure + build + gitleaks + npm audit all pass (${((Date.now() - t0) / 1000).toFixed(0)}s total)`
);
