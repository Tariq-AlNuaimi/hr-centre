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
import { readFileSync, writeFileSync } from "node:fs";
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

// ── Sound glob-overlap (senior-review High fix) ────────────────────────────────
// Two globs overlap iff SOME path matches both. The old representative-path probe
// (wildcards → the literal "x", cross-tested once) was false-disjoint whenever the
// collision needed a wildcard to resolve to something other than "x" — e.g.
// `lib/validations/order*.ts` ∩ `lib/validations/*.test.ts` on `order.test.ts`. That
// is the "dangerous direction": check-overlap would pass a manifest that actually
// collides. This is a real intersection test over the flat glob subset (`**`, `*`,
// `?`, literals) — `**` matches any run of whole segments, `*`/`?` stay within one
// segment. Sound (no false "disjoint"); conservative only in that a segment token
// literally containing `**` (rare, e.g. `a**b`) is treated as `a*b`.

/** Split a glob into segments; a whole-segment `**` is kept as the cross-segment token. */
export function normSegs(glob) {
  return glob
    .trim()
    .split("/")
    .filter(Boolean)
    .map((s) => (s === "**" ? "**" : s.replace(/\*\*/g, "*")));
}

/** Do two single-segment patterns (only `*`/`?`, no `/`) share a common match? */
export function segmentsIntersect(a, b) {
  const A = a.length;
  const B = b.length;
  const memo = new Map();
  const go = (i, j) => {
    const key = i * (B + 1) + j;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, false); // DAG guard (the only cycle is the `*`∩`*` self-loop, skipped below)
    let res = false;
    if (!res && i < A && a[i] === "*") res = go(i + 1, j); // `*` matches zero chars
    if (!res && j < B && b[j] === "*") res = go(i, j + 1);
    if (!res && i === A && j === B) res = true;
    if (!res && i < A && j < B) {
      const ca = a[i];
      const cb = b[j];
      const wildA = ca === "*" || ca === "?";
      const wildB = cb === "*" || cb === "?";
      const common = wildA || wildB || ca === cb; // some char both can consume?
      if (common) {
        const ni = ca === "*" ? i : i + 1; // `*` stays (can match more)
        const nj = cb === "*" ? j : j + 1;
        if (ni !== i || nj !== j) res = go(ni, nj); // skip the `*`∩`*` self-loop
      }
    }
    memo.set(key, res);
    return res;
  };
  return go(0, 0);
}

/** Do two segment-lists overlap, with `**` absorbing zero-or-more whole segments? */
function segsOverlap(a, i, b, j) {
  if (i < a.length && a[i] === "**")
    return segsOverlap(a, i + 1, b, j) || (j < b.length && segsOverlap(a, i, b, j + 1));
  if (j < b.length && b[j] === "**")
    return segsOverlap(a, i, b, j + 1) || (i < a.length && segsOverlap(a, i + 1, b, j));
  if (i === a.length || j === b.length) return i === a.length && j === b.length;
  if (!segmentsIntersect(a[i], b[j])) return false;
  return segsOverlap(a, i + 1, b, j + 1);
}

/** Could two globs match a common path? Sound intersection over the flat glob subset. */
export function globsOverlap(a, b) {
  return segsOverlap(normSegs(a), 0, normSegs(b), 0);
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

/**
 * Working-tree changes as project-relative paths (modified + untracked, ONE line per
 * file). `-uall` is required (senior-review Medium): the default porcelain collapses a
 * brand-new directory tree into a single entry, so per-file attribution would test a bare
 * dir path against file globs and mis-flag a correct wave.
 */
export function changedFiles(root = ROOT) {
  const out = execFileSync(
    "git",
    ["-c", "core.quotepath=false", "status", "--porcelain", "-uall"],
    { cwd: root, encoding: "utf8" },
  );
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

/** Baseline path for a manifest — the pre-wave dirty set, so verify-scope ignores it. */
function baselinePath(manifestPath) {
  return `${manifestPath}.baseline`;
}

/** Snapshot the pre-wave dirty set so a not-actually-clean tree can't skew verify-scope. */
function writeBaseline(manifestPath) {
  const before = changedFiles();
  writeFileSync(baselinePath(manifestPath), JSON.stringify(before), "utf8");
  return before;
}

/** The recorded pre-wave dirty set (empty + a "no baseline" flag if none was snapshotted). */
function readBaseline(manifestPath) {
  try {
    return { files: JSON.parse(readFileSync(baselinePath(manifestPath), "utf8")), had: true };
  } catch {
    return { files: [], had: false };
  }
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
    // Snapshot the pre-wave dirty set so verify-scope can subtract it (clean-tree
    // precondition enforced by code, not just documented — senior-review Medium).
    const before = writeBaseline(manifestPath);
    const dirtyNote = before.length
      ? ` (recorded ${before.length} pre-existing dirty file(s) to ignore at verify-scope)`
      : "";
    process.stdout.write(
      `[fan-out] OK — ${units.length} units, declared sets are write-disjoint${dirtyNote}.\n`,
    );
    return;
  }

  // verify-scope — subtract the pre-wave baseline so a not-actually-clean tree can't skew it.
  const baseline = readBaseline(manifestPath);
  const baseSet = new Set(baseline.files);
  const changed = changedFiles().filter((f) => !baseSet.has(f));
  if (!baseline.had)
    process.stderr.write(
      "[fan-out] WARN — no baseline snapshot found (run check-overlap first, from a clean tree); " +
        "assuming the whole working tree is this wave's output.\n",
    );
  const outOfScope = [];
  const overlapHits = [];
  for (const f of changed) {
    const hits = unitsMatching(f, units);
    if (hits.length === 0) outOfScope.push(f);
    else if (hits.length > 1) overlapHits.push({ f, hits });
  }
  if (!outOfScope.length && !overlapHits.length) {
    // Positive-completion signal (senior-review Low): a wave where nothing changed is
    // suspicious (a unit may have silently no-op'd) — say so instead of a bare "OK".
    const declared = units.flatMap((u) => u.files);
    const touchedUnits = new Set(changed.flatMap((f) => unitsMatching(f, units)));
    const silent = units.filter((u) => !touchedUnits.has(u.id)).map((u) => u.id);
    const silentNote = silent.length
      ? ` — but unit(s) [${silent.join(", ")}] changed NO files (silently no-op'd? verify each ran)`
      : "";
    process.stdout.write(
      `[fan-out] OK — ${changed.length} changed file(s) across ${declared.length} declared glob(s), ` +
        `all within exactly one unit's declared set${silentNote}.\n`,
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
