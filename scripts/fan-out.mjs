#!/usr/bin/env node
// scripts/fan-out.mjs — enforcement helper for the /fan-out skill (ADR-057).
//
// The custom-verdict half of ADR-057: native subagent dispatch does the parallel
// work; THIS script is the file-ownership *enforcement* native lacks. Two checks,
// both pure git/path arithmetic (no runtime deps), reusing the shared glob matcher:
//
//   check-overlap <manifest.json>
//       PRE-dispatch. Refuse the wave if two units' declared file-ownership sets
//       could match a common path (sets must be write-disjoint). Exit 1 on overlap.
//
//   verify-scope  <manifest.json>
//       POST-dispatch. Every file the wave changed (working-tree status — run from a
//       CLEAN tree, like /batch) must match EXACTLY ONE unit's declared set:
//         * 0 matches  → an out-of-scope write (a unit wrote outside every set);
//         * ≥2 matches → the declared sets overlapped on a real file (not disjoint).
//       Exit 1 on any violation, listing the offending files.
//
// Manifest shape (JSON):
//   { "units": [ { "id": "auth",  "files": ["lib/auth.ts", "lib/validations/auth.ts"] },
//                { "id": "routes","files": ["app/api/widgets/**"] } ] }
//
// Fail-open by nature of a helper (bad manifest → exit 2 with a message, not a crash).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { globToRe, relPath } from "../.claude/hooks/lib/scope-cover.mjs";

const ROOT = process.cwd();

/** Parse + validate a manifest file. Throws a friendly Error on any shape problem. */
export function loadManifest(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`manifest not found or unreadable: ${path}`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`manifest is not valid JSON: ${e.message}`);
  }
  if (!obj || !Array.isArray(obj.units) || obj.units.length === 0)
    throw new Error('manifest must have a non-empty "units" array');
  const ids = new Set();
  for (const u of obj.units) {
    if (!u || typeof u.id !== "string" || !u.id.trim())
      throw new Error("every unit needs a non-empty string id");
    if (ids.has(u.id)) throw new Error(`duplicate unit id: ${u.id}`);
    ids.add(u.id);
    if (!Array.isArray(u.files) || u.files.length === 0)
      throw new Error(`unit "${u.id}" needs a non-empty files array (its ownership set)`);
    for (const g of u.files)
      if (typeof g !== "string" || !g.trim())
        throw new Error(`unit "${u.id}" has an empty/non-string file glob`);
  }
  return obj;
}

/** A concrete representative path for a glob (wildcards → a fixed segment token). */
export function representativePath(glob) {
  return glob.trim().replace(/\*\*/g, "x").replace(/\*/g, "x").replace(/\?/g, "x");
}

/** Could two globs match a common path? Heuristic via representative-path cross-test. */
export function globsOverlap(a, b) {
  return globToRe(b).test(representativePath(a)) || globToRe(a).test(representativePath(b));
}

/** All cross-unit declared-set overlaps: [{ a, b, globA, globB }]. */
export function findDeclaredOverlaps(units) {
  const out = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      for (const ga of units[i].files) {
        for (const gb of units[j].files) {
          if (globsOverlap(ga, gb))
            out.push({ a: units[i].id, b: units[j].id, globA: ga, globB: gb });
        }
      }
    }
  }
  return out;
}

/** Which units' declared sets does a project-relative path match? (list of ids) */
export function unitsMatching(rel, units) {
  return units.filter((u) => u.files.some((g) => globToRe(g).test(rel))).map((u) => u.id);
}

/** Working-tree changes vs a clean tree: project-relative paths (modified + untracked). */
export function changedFiles(root = ROOT) {
  const out = execFileSync("git", ["-c", "core.quotepath=false", "status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  const files = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    // porcelain: "XY <path>" or "XY <old> -> <new>" for renames — take the final path.
    const rest = line.slice(3);
    const p = rest.includes(" -> ") ? rest.split(" -> ").pop() : rest;
    files.push(relPath(p.trim(), root));
  }
  return files;
}

function die(msg, code = 2) {
  process.stderr.write(`[fan-out] ${msg}\n`);
  process.exit(code);
}

function main(argv) {
  const [cmd, manifestPath] = argv;
  if (!cmd || !["check-overlap", "verify-scope"].includes(cmd))
    die("usage: fan-out.mjs <check-overlap|verify-scope> <manifest.json>");
  if (!manifestPath) die(`${cmd} needs a manifest path`);

  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (e) {
    die(e.message);
  }
  const { units } = manifest;

  if (cmd === "check-overlap") {
    const overlaps = findDeclaredOverlaps(units);
    if (overlaps.length) {
      process.stderr.write(
        "[fan-out] REFUSING to dispatch — declared file-ownership sets overlap:\n",
      );
      for (const o of overlaps)
        process.stderr.write(`  • unit "${o.a}" (${o.globA}) ∩ unit "${o.b}" (${o.globB})\n`);
      process.stderr.write(
        "  Fix: narrow the sets so they are write-disjoint, or serialize the overlapping units.\n",
      );
      process.exit(1);
    }
    process.stdout.write(
      `[fan-out] OK — ${units.length} units, declared sets are write-disjoint.\n`,
    );
    return;
  }

  // verify-scope
  const changed = changedFiles();
  const outOfScope = [];
  const overlapHits = [];
  for (const f of changed) {
    const hits = unitsMatching(f, units);
    if (hits.length === 0) outOfScope.push(f);
    else if (hits.length > 1) overlapHits.push({ f, hits });
  }
  if (!outOfScope.length && !overlapHits.length) {
    process.stdout.write(
      `[fan-out] OK — ${changed.length} changed file(s), all within exactly one unit's declared set.\n`,
    );
    return;
  }
  if (outOfScope.length) {
    process.stderr.write("[fan-out] OUT-OF-SCOPE writes (matched no unit's declared set):\n");
    for (const f of outOfScope) process.stderr.write(`  • ${f}\n`);
  }
  if (overlapHits.length) {
    process.stderr.write("[fan-out] OVERLAP writes (a real file matched ≥2 units' sets):\n");
    for (const h of overlapHits) process.stderr.write(`  • ${h.f} → [${h.hits.join(", ")}]\n`);
  }
  process.stderr.write(
    "  A parallel wave must stay inside its declared file-ownership. Revert the stray writes or re-run the affected unit.\n",
  );
  process.exit(1);
}

// Run only as a CLI (keep exports importable by the hook test suite).
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
