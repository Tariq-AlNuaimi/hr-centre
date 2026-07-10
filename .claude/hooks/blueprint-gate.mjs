#!/usr/bin/env node
// PreToolUse hook (Edit|Write|MultiEdit matcher) -- the blueprint-before-build gate
// (ADR-033). Second of the enforcement-layer gates (see ADR-032 for the pattern).
//
// Problem it solves: the model's default is to jump straight to feature code —
// skipping planning, user stories, worst-path scenarios, and clarifying questions —
// then fill the requirement gaps with guesses that become rebuilds. "Blueprint before
// building" and "auto-plan / ask clarifying questions" were advisory (CLAUDE.md) and
// lost to that default. This gate makes a blueprint a HARD precondition for the two
// unambiguous "a feature is being built" signals: a NEW API route or a NEW page.
//
// What it does: denies creation of a new app/api/**/route.ts or app/**/page.tsx unless
// some docs/blueprints/*.md carries a `Scope:` glob covering that path. Producing the
// blueprint (via /blueprint — user stories + happy/worst scenarios + open questions
// resolved with AskUserQuestion) is the point; the Scope line is what the gate matches.
// Both blueprint tracks emit it: the full track a committed doc, the lightweight track a
// minimal Scope'd stub (so /quickstart flows through the gate rather than being blocked).
//
// Narrow by design: only NEW route/page files. Edits to existing routes/pages, lib code
// (gated separately by build-vs-buy-gate.mjs), and components never trip it.
//
// Fail-open: on any internal error it stays silent and allows -- a build-quality gate
// must never brick a session (the guard-hook convention; see ADR-032).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const BLUEPRINTS = resolve(ROOT, "docs/blueprints");

/** Project-relative, forward-slashed path (abs or relative input). */
function relPath(fp) {
  if (!fp) return "";
  return relative(ROOT, resolve(ROOT, fp)).split("\\").join("/");
}

/** Is this new file a "feature is being built" surface? */
function isFeatureFile(rel) {
  if (!rel || rel.startsWith("..")) return false;
  if (/^app\/api\/.+\/route\.ts$/.test(rel)) return true;      // new API route
  if (/^app\/.+\/page\.tsx$/.test(rel)) return true;           // new page/screen
  return false;
}

/** Minimal glob -> RegExp: ** = any depth, * = within a segment. */
function globToRe(glob) {
  const esc = glob.trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${esc}$`);
}

/** Any docs/blueprints/*.md whose Scope: glob covers `rel`? */
function blueprintCovers(rel) {
  if (!existsSync(BLUEPRINTS)) return false;
  for (const name of readdirSync(BLUEPRINTS)) {
    if (!name.endsWith(".md")) continue;
    let text = "";
    try { text = readFileSync(join(BLUEPRINTS, name), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const m = /^\s*Scope:\s*(.+?)\s*$/i.exec(line);
      if (!m) continue;
      for (const g of m[1].split(",")) {
        const glob = g.trim();
        if (glob && globToRe(glob).test(rel)) return true;
      }
    }
  }
  return false;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if ((input.tool_name ?? "") !== "Write") process.exit(0);
  const fp = input.tool_input?.file_path ?? "";
  const rel = relPath(fp);
  if (existsSync(resolve(ROOT, fp))) process.exit(0);         // overwrite = continuation
  if (!isFeatureFile(rel)) process.exit(0);
  if (blueprintCovers(rel)) process.exit(0);

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `[blueprint-gate] Denied: '${rel}' is new feature code with no blueprint ` +
        `covering it (ADR-033; CLAUDE.md "Blueprint before building"). Run /blueprint ` +
        `FIRST: pin down user stories, happy + worst-path scenarios, and resolve open ` +
        `questions with AskUserQuestion (don't guess the requirements). Then ensure the ` +
        `blueprint carries a "Scope:" line covering this file — e.g. ` +
        `"Scope: ${rel.replace(/[^/]+$/, "**")}". Lightweight/quickstart work still writes ` +
        `a minimal Scope'd stub under docs/blueprints/. The blueprint is the contract ` +
        `/qa and /uat trace against; building without it is the rebuild this gate prevents.`,
    },
  }));
} catch { /* fail-open: never brick the session */ }
process.exit(0);
