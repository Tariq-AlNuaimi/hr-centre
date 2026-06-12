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
import { existsSync, readFileSync, rmSync } from "node:fs";

const CACHE = "node_modules/.cache";

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
const fail = (r) => {
  console.error(`\nship: RED -- ${r.name} failed. First 20 lines:\n`);
  console.error(r.out.split("\n").slice(0, 20).join("\n"));
  process.exit(1);
};

const t0 = Date.now();
console.log("ship: phase A (typecheck | lint | contract tests | component tests) ...");

const typecheck = () =>
  run("typecheck", "npx", ["tsc", "--noEmit", "--tsBuildInfoFile", `${CACHE}/ship.tsbuildinfo`]);

let [tsc, lint, contract, components] = await Promise.all([
  typecheck(),
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

for (const r of [tsc, lint, contract, components]) report(r);
const redA = [tsc, lint, contract, components].find((r) => !r.ok);
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

const audit = await run("npm audit", "npm", ["audit", "--audit-level=high", "--omit=dev"]);
report(audit);
if (!audit.ok) fail(audit);

console.log(
  `\nship: green -- typecheck + lint + tests + component tests + build + gitleaks + npm audit all pass (${((Date.now() - t0) / 1000).toFixed(0)}s total)`
);
