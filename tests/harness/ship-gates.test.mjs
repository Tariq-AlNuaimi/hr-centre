// Regression tests for two harness mechanisms that had ZERO coverage until
// 2026-07-25, and which were both found to be wrong when finally exercised:
//
//   scanSessionState (scripts/ship.mjs) -- reported "this branch is the fix" for
//     ANY branch that merely never had the files, and skipped entirely when the
//     default branch was not named `main`.
//   pruneDocsMode --apply (scripts/rebrand.mjs) -- a real file-deletion path that
//     auto-runs on every /rebrand and that scripts/deploy.mjs shells out to.
//
// Both were verified by ad-hoc probing. Ad-hoc probing does not survive the
// session, which is how they went unexercised for so long -- so the probes are
// committed here instead.
//
// scanSessionState has no export seam (ship.mjs is a top-level script that runs
// on import), so it is extracted from the SOURCE TEXT and evaluated. That is
// deliberate: it tests the shipped function rather than a copy of its logic that
// could drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE = ["docs/SESSION-HANDOFF.md", "docs/session-state.json"];

function loadGate() {
  const src = readFileSync(join(REPO, "scripts", "ship.mjs"), "utf8");
  const constMatch = src.match(/const BRANCH_ONLY_STATE = \[[^\]]*\];/s);
  const fnMatch = src.match(/function scanSessionState\(\) \{[\s\S]*?\n\}/);
  assert.ok(constMatch && fnMatch, "could not extract scanSessionState from ship.mjs");
  return new Function("execSync", `${constMatch[0]}\n${fnMatch[0]}\nreturn scanSessionState;`)(
    execSync,
  );
}

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] });

/** Build a throwaway repo, run the gate inside it, return "RED" | "GREEN" | "SKIP". */
function verdictIn(build) {
  const dir = mkdtempSync(join(tmpdir(), "ship-gate-"));
  const cwd0 = process.cwd();
  try {
    sh("git init -q -b main .", dir);
    sh("git config user.email t@t && git config user.name t && mkdir -p docs", dir);
    writeFileSync(join(dir, "docs", "a.txt"), "base\n");
    sh("git add -A && git commit -qm base", dir);
    build(dir);
    process.chdir(dir);
    const r = loadGate()();
    if (!r.ok) return "RED";
    return /skipped/.test(r.out) ? "SKIP" : "GREEN";
  } finally {
    process.chdir(cwd0);
    rmSync(dir, { recursive: true, force: true });
  }
}

const leak = (d) => {
  for (const p of STATE) writeFileSync(join(d, p), "x\n");
  sh("git add -A && git commit -qm leak", d);
};

test("session-state: a branch that never had the files does NOT count as the fix", () => {
  // The original false GREEN. During an active leak this describes almost every
  // in-flight branch, so the gate failed open exactly when it mattered.
  const v = verdictIn((d) => {
    sh("git switch -qc stale", d);
    writeFileSync(join(d, "docs", "f.txt"), "w\n");
    sh("git add -A && git commit -qm w", d);
    sh("git switch -q main", d);
    leak(d);
    sh("git switch -q stale", d);
  });
  assert.equal(v, "RED", "absence is not removal — merging this branch leaves main dirty");
});

test("session-state: a branch that genuinely REMOVED the files is the remediation", () => {
  const v = verdictIn((d) => {
    leak(d);
    sh("git switch -qc fixer", d);
    sh(`git rm -q --cached ${STATE.join(" ")} && git commit -qm remove`, d);
  });
  assert.equal(v, "GREEN", "REDing the fix would block the very push that resolves the leak");
});

test("session-state: steady state — main clean, branch tracks them", () => {
  const v = verdictIn((d) => {
    sh("git switch -qc work", d);
    leak(d);
  });
  assert.equal(v, "GREEN", "tracking branch-only state ON A BRANCH is the documented behavior");
});

test("session-state: a fork whose default branch is not `main` is still guarded", () => {
  // Before origin/HEAD resolution this returned "no main ref (skipped)" and such
  // a fork was never checked at all.
  const v = verdictIn((d) => {
    sh("git branch -m main trunk", d);
    leak(d);
    sh("git switch -qc work", d);
  });
  assert.equal(v, "RED", "renaming the default branch must not silently disable the gate");
});

// --- rebrand --apply delete path -------------------------------------------

test("rebrand --apply deletes template-dev docs without escaping the tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "prune-"));
  try {
    const outside = join(dir, "OUTSIDE");
    const sandbox = join(dir, "sandbox");
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(sandbox, "scripts"), { recursive: true });
    mkdirSync(join(sandbox, "docs", "keepme"), { recursive: true });
    mkdirSync(join(sandbox, "docs", "prunable"), { recursive: true });
    writeFileSync(join(outside, "secret.md"), "precious\n");
    writeFileSync(join(sandbox, "docs", "keepme", "adr.md"), "keep\n");
    writeFileSync(join(sandbox, "docs", "prunable", "history.md"), "prune\n");
    writeFileSync(
      join(sandbox, "scripts", "rebrand.mjs"),
      readFileSync(join(REPO, "scripts", "rebrand.mjs"), "utf8"),
    );
    // A symlink out of the tree, classified prunable: deleting the LINK is
    // correct; following it to the target would destroy unrelated files.
    symlinkSync(join(outside, "secret.md"), join(sandbox, "docs", "prunable", "link.md"));
    // A symlinked DIRECTORY: the walk must not recurse through it.
    symlinkSync(outside, join(sandbox, "docs", "prunable", "linkdir"));
    writeFileSync(
      join(sandbox, "docs", "doc-manifest.json"),
      JSON.stringify({
        note: "test",
        version: 1,
        roots: ["docs", "."],
        rules: [
          { glob: "docs/keepme/**", inheritance: "fork", why: "survives" },
          { glob: "docs/prunable/**", inheritance: "template-dev", why: "deleted" },
          { glob: "**", inheritance: "fork", why: "catch-all keeps" },
        ],
      }),
    );

    execSync("node scripts/rebrand.mjs --prune-docs --apply", {
      cwd: sandbox,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const exists = (p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    };
    assert.ok(exists(join(outside, "secret.md")), "must NOT follow a symlink out of the tree");
    assert.ok(exists(join(sandbox, "docs", "keepme", "adr.md")), "fork-inherited docs survive");
    assert.ok(
      !exists(join(sandbox, "docs", "prunable", "history.md")),
      "template-dev docs are deleted",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The verdict accumulator's classification contract (senior review, 2026-08-21).
// ---------------------------------------------------------------------------
// `report()` decides `ran` vs `DEGRADED` purely from the presence of `warn`. Ten
// early-returns across scanBlueprint/scanComplexity/scanTier/scanSessionState/
// scanWaveOffs said "I checked nothing" ONLY in their `out` string, so they were
// counted as having RUN and printed under `ran (N)` -- the exact "reports success
// without doing the work" bug the accumulator was built to kill, reintroduced
// inside it. Two of them are enforcement-quartet gates whose skip path is the
// NORMAL state of a shallow clone or a detached-HEAD CI checkout.
//
// Asserted over the SOURCE rather than by driving each gate into its skip state:
// the invariant is "no result object claims (skipped) without a warn", and that is
// a property of the text. A regex fix in report() was tried first and rejected --
// sniffing `out` mislabelled `contract tests` as degraded, because TAP output
// contains skip words. `warn` is the signal; this keeps every skip path setting it.
test("every (skipped) ship result also sets `warn` (else the verdict counts it as ran)", () => {
  const src = readFileSync(join(REPO, "scripts", "ship.mjs"), "utf8");
  const offenders = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (!/\(skipped\)/.test(line)) return;
    if (!/^\s*(return|.*=>)/.test(line) && !/name:\s*"/.test(line)) return;
    // The result may be built across a couple of lines; look at a small window.
    const window = lines.slice(i, i + 3).join(" ");
    if (!/\bwarn\b/.test(window)) offenders.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(
    offenders,
    [],
    "these ship.mjs results say (skipped) but set no `warn`, so the final verdict " +
      "would list them under `ran` as if they had executed:\n  " +
      offenders.join("\n  "),
  );
});
