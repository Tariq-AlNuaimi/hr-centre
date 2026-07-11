#!/usr/bin/env node
// scripts/sync-from-template.mjs
//
// Pull later template enhancements into a fork that was GENERATED from this
// template (GitHub "Use this template" -> no shared git history). Because the
// fork and the template are unrelated git histories, a blind merge is painful
// (unrelated histories + every fork was /rebrand-ed, so identity strings
// collide). Instead we do a PATH-SCOPED checkout of the template-owned layers
// only, leave everything staged for the operator to review, and never touch the
// fork's own data/features.
//
// Two file classes:
//   OWNED  -- pure template infrastructure (skills, eslint-rules, harness
//             scripts, decision records, lint config). Path-scoped checkout is
//             ADDITIVE: it updates/creates files that exist in the template at
//             these paths and never deletes fork-only files there. Safe to pull.
//   REVIEW -- mixed: template improvements AND per-fork customizations both live
//             here (lib/, CLAUDE.md, the Ask-before files). NEVER auto-applied;
//             we emit a diff for the operator to merge by hand.
//
// Everything else (prisma/, app/, components/, messages/, project.config.json,
// package identity, .env) is fork-owned and never touched.
//
// Version tracking: each successful sync writes `.template-sync.json` recording
// the template commit the fork is now based on. `--check` fetches the template
// and reports how many template commits have landed since that baseline, so a
// fork can tell when it is behind without modifying anything.
//
// Modes:
//   (default)   sync: checkout OWNED (staged for review), emit REVIEW diff,
//               update the marker.
//   --check     read-only: report behind-count + changed files, exit 3 if behind.
//   --dry-run   show what sync WOULD change; touch nothing.
//
// Flags: --template <url> --ref <branch> --remote <name>

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { step, ok, warn, info, bail } from "./lib/log.mjs";

const P = "sync-template";

const { values } = parseArgs({
  options: {
    template: { type: "string" },
    ref: { type: "string", default: "main" },
    remote: { type: "string", default: "template" },
    check: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const TEMPLATE_DEFAULT = "https://github.com/Tariq-AlNuaimi/fullstack-vibe-template.git";
const MARKER = ".template-sync.json";
const REVIEW_DIFF = ".template-sync-review.diff";

// Template-owned: safe, additive, path-scoped checkout. Keep this list
// CONSERVATIVE -- anything a fork is likely to customize belongs in REVIEW.
const OWNED = [
  ".claude/skills",
  ".claude/agents",
  ".claude/hooks",
  ".claude/statusline.mjs",
  "eslint-rules",
  "scripts",
  "docs/decisions",
  "docs/token-policy.md",
  "docs/recipes.md",
  "docs/uat-rubric.md",
  ".gitleaks.toml",
  "eslint.config.mjs",
];

// Mixed: template + per-fork edits coexist here. Show a diff; never auto-apply.
// lib/api-helpers.ts, lib/rate-limit.ts, lib/email.ts, lib/export.ts and
// everything under lib/prisma/ are Ask-before files (CLAUDE.md) -- a human must
// reconcile those, which is exactly why lib/ lives here and not in OWNED.
const REVIEW = [
  "lib",
  "CLAUDE.md",
  "AGENTS.md",
  ".claude/settings.json",
  "middleware.ts",
  "vercel.json",
  "next.config.ts",
  "package.json",
  "tsconfig.json",
  "playwright.config.ts",
  "tests/contracts",
];

// --- git helpers ------------------------------------------------------------
// git(): run git, return trimmed stdout, throw on non-zero. gitTry(): same but
// returns null on failure (for probes where "missing" is an expected answer).
function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...opts }).trim();
}
function gitTry(args, opts = {}) {
  try {
    return git(args, { stdio: ["ignore", "pipe", "ignore"], ...opts });
  } catch {
    return null;
  }
}

// Run from the repo root so the relative pathspecs above resolve regardless of
// where npm invoked us.
const repoRoot = gitTry(["rev-parse", "--show-toplevel"]);
if (!repoRoot) bail(P, "Not inside a git repository.");
process.chdir(repoRoot);

const willModify = !values.check && !values["dry-run"];

// A path-scoped checkout writes into the working tree; refuse on a dirty tree so
// template changes never get tangled with uncommitted work. Read-only modes are
// always allowed.
if (willModify) {
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    bail(
      P,
      "Working tree is dirty. Commit or stash first so the template sync lands " +
        "as its own reviewable change:\n" +
        dirty
          .split("\n")
          .slice(0, 10)
          .map((l) => `    ${l}`)
          .join("\n"),
    );
  }
}

// --- resolve template remote ------------------------------------------------
// URL precedence: explicit --template > the URL recorded in a prior sync marker
// > the canonical default. This lets a fork that synced once keep using the same
// source without re-passing the flag.
let markerData = null;
if (existsSync(MARKER)) {
  try {
    markerData = JSON.parse(readFileSync(MARKER, "utf8"));
  } catch {
    warn(P, `${MARKER} is present but not valid JSON; ignoring it.`);
  }
}
const templateUrl = values.template || markerData?.template || TEMPLATE_DEFAULT;
const remote = values.remote;
const ref = values.ref;

const existingUrl = gitTry(["remote", "get-url", remote]);
if (!existingUrl) {
  step(P, `Adding remote '${remote}' -> ${templateUrl}`);
  git(["remote", "add", remote, templateUrl]);
} else if (existingUrl !== templateUrl && values.template) {
  step(P, `Updating remote '${remote}' -> ${templateUrl}`);
  git(["remote", "set-url", remote, templateUrl]);
} else {
  info(P, `Using remote '${remote}' (${existingUrl}).`);
}

step(P, `Fetching ${remote}/${ref}...`);
try {
  git(["fetch", "--quiet", remote, ref], { stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  bail(
    P,
    `git fetch ${remote} ${ref} failed. If the template repo is private, ensure ` +
      `your git credentials can read ${templateUrl}.\n  ${String(e.message).slice(0, 300)}`,
  );
}

const templateSha = git(["rev-parse", `${remote}/${ref}`]);
const templateShort = templateSha.slice(0, 7);

// --- compute what differs ---------------------------------------------------
// "Behind" = how many template commits landed since this fork's recorded
// baseline. Without a marker (never synced) we can't count commits across the
// unrelated histories, so we report it as a first sync.
const baseline = markerData?.syncedSha || null;
let behindCount = null;
if (baseline) {
  const c = gitTry(["rev-list", "--count", `${baseline}..${remote}/${ref}`]);
  behindCount = c === null ? null : Number(c);
}

// Files where the fork's current tree differs from the template, split by class.
// `git diff --name-only HEAD <ref> -- <paths>` is the actionable set: what a sync
// would (OWNED) or could (REVIEW) bring in.
function changedUnder(paths) {
  const out = git(["diff", "--name-only", "HEAD", `${remote}/${ref}`, "--", ...paths]);
  return out ? out.split("\n").filter(Boolean) : [];
}
const ownedChanged = changedUnder(OWNED);
const reviewChanged = changedUnder(REVIEW);
const anyDiff = ownedChanged.length || reviewChanged.length;

function reportBehind() {
  if (!baseline) {
    info(P, `No prior sync recorded -- this would be the FIRST template sync.`);
  } else if (behindCount === null) {
    warn(
      P,
      `Recorded baseline ${baseline.slice(0, 7)} is not in the fetched template ` +
        `history (template may have been rebased). Treating all diffs as candidates.`,
    );
  } else if (behindCount === 0 && !anyDiff) {
    ok(P, `Up to date with template ${templateShort} (${ref}).`);
  } else if (behindCount === 0) {
    // Marker matches template HEAD but tracked files still differ: either local
    // divergence at an owned path, or a prior sync that was staged but not yet
    // committed. Either way there is real work to review.
    warn(
      P,
      `Marker matches template ${templateShort}, but tracked files differ ` +
        `(local divergence, or a prior sync not yet committed).`,
    );
  } else {
    warn(
      P,
      `Behind by ${behindCount} template commit(s): baseline ${baseline.slice(0, 7)} -> ${templateShort}.`,
    );
  }
}

function listChanges() {
  if (ownedChanged.length) {
    info(P, `Template-owned files that differ (${ownedChanged.length}):`);
    for (const f of ownedChanged) console.log(`    ~ ${f}`);
  } else {
    ok(P, "No template-owned files differ.");
  }
  if (reviewChanged.length) {
    info(P, `Review-needed files that differ (${reviewChanged.length}) -- NOT auto-applied:`);
    for (const f of reviewChanged) console.log(`    ? ${f}`);
  } else {
    ok(P, "No review-needed files differ.");
  }
}

// --- read-only modes --------------------------------------------------------
if (values.check) {
  reportBehind();
  listChanges();
  // Exit 3 when behind so a hook/CI can branch on it; 0 when clean.
  process.exit(anyDiff ? 3 : 0);
}

if (values["dry-run"]) {
  reportBehind();
  step(P, "DRY-RUN: would checkout these template-owned paths (additive):");
  listChanges();
  info(P, "DRY-RUN: nothing written. Re-run without --dry-run to apply.");
  process.exit(0);
}

// --- apply ------------------------------------------------------------------
reportBehind();

if (!anyDiff) {
  ok(P, "Nothing to sync. Updating marker only.");
}

// 1. OWNED: path-scoped checkout, then unstage so the operator reviews the
//    result as ordinary working-tree changes (mirrors the manual recipe). Skip
//    any path that no longer exists in the template tree -- checkout errors on a
//    pathspec that matches nothing.
const applied = [];
for (const path of OWNED) {
  const inTree = gitTry(["ls-tree", `${remote}/${ref}`, "--", path]);
  if (!inTree) continue; // template removed this path; nothing to pull
  git(["checkout", `${remote}/${ref}`, "--", path]);
  applied.push(path);
}
// Unstage so the result reviews as ordinary working-tree changes. checkout only
// touches files that actually differ, so `ownedChanged` is the real change set.
if (applied.length) gitTry(["reset", "--quiet", "HEAD", "--", ...applied]);
if (ownedChanged.length) {
  ok(P, `Pulled ${ownedChanged.length} template-owned file(s): ${ownedChanged.join(", ")}`);
} else {
  ok(P, "Template-owned layers already match; nothing pulled.");
}

// 2. REVIEW: never auto-apply. Emit a diff the operator merges by hand.
if (reviewChanged.length) {
  const diff = git(["diff", "HEAD", `${remote}/${ref}`, "--", ...REVIEW]);
  writeFileSync(REVIEW_DIFF, diff + "\n");
  warn(
    P,
    `${reviewChanged.length} mixed file(s) need manual review -- wrote the diff to ` +
      `${REVIEW_DIFF} (gitignored). These include Ask-before files; reconcile by hand:`,
  );
  for (const f of reviewChanged) console.log(`    ? ${f}`);
}

// 3. Version marker: record the template commit this fork is now based on.
const marker = {
  template: templateUrl,
  ref,
  syncedSha: templateSha,
  syncedShortSha: templateShort,
  syncedAt: new Date().toISOString(),
  note:
    "Written by scripts/sync-from-template.mjs (/sync-from-template). Records the " +
    "template commit this fork last pulled. Commit this file; do not edit by hand.",
};
writeFileSync(MARKER, JSON.stringify(marker, null, 2) + "\n");
ok(P, `Marked synced to template ${templateShort}.`);

// 4. Next steps.
console.log(
  [
    "",
    "## Template sync staged",
    "",
    `- Synced to template \`${templateShort}\` (${ref}).`,
    ownedChanged.length
      ? `- Auto-pulled (review then commit): ${ownedChanged.join(", ")}`
      : "- No template-owned layers changed.",
    reviewChanged.length
      ? `- Manual merge needed (see \`${REVIEW_DIFF}\`): ${reviewChanged.join(", ")}`
      : "- No mixed files needed manual review.",
    "",
    "## Do next",
    "",
    "1. Review the working-tree changes: `git diff`.",
    reviewChanged.length
      ? `2. Merge the mixed files by hand from \`${REVIEW_DIFF}\` (esp. any lib/ Ask-before files).`
      : "2. (No manual merges.)",
    "3. If anything under auth/`lib`/schemas/API routes changed: run `/code-review`.",
    "4. `npm run ship` until green, then commit (include `.template-sync.json`).",
    "",
  ].join("\n"),
);
ok(P, "Done.");
