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
//
// V2-002 (Scope-glob hygiene): coverage now runs through the shared scope-cover helper,
// which ignores over-broad Scope globs (`app/**`, `app/api/**`, `lib/**`, bare `**`) and
// expired stubs — so a lazy one-line stub can't wave a whole feature area past this gate.
//
// C3 (tiered friction): a hard DENY on every fork contradicted /quickstart's "idea → live
// URL in ~10 minutes" promise. The gate is now tiered exactly like scripts/ship.mjs's own
// `blueprint` check, which has always blocked on `"tier": "shared"` and merely warned on the
// `"personal"` default: shared-tier work still gets `permissionDecision: "deny"`; personal /
// disposable work gets an advisory `additionalContext` naming the same missing artifact and
// the same remedy. The signal is the EXISTING project.config.json `tier` key — no new config.
// Rationale (red-team R6): this is a PROCESS gate, not a security control (its artifact is
// agent-writable), so the friction should be proportionate to the blast radius, not uniform.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  relPath as relTo,
  isFeatureFile,
  blueprintCoverInfo,
  isSharedTier,
} from "./lib/scope-cover.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Project-relative, forward-slashed path (abs or relative input). */
function relPath(fp) {
  return relTo(fp, ROOT);
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if ((input.tool_name ?? "") !== "Write") process.exit(0);
  const fp = input.tool_input?.file_path ?? "";
  const rel = relPath(fp);
  if (existsSync(resolve(ROOT, fp))) process.exit(0); // overwrite = continuation
  if (!isFeatureFile(rel)) process.exit(0);
  const cover = blueprintCoverInfo(rel, ROOT);
  if (cover.covered) process.exit(0);

  // V2-002: explain WHY an existing-but-ignored Scope line didn't count.
  const hygiene = cover.sawBroadMatch
    ? ` A blueprint's Scope glob matches '${rel}' but is TOO BROAD (a whole structural ` +
      `root like app/**, app/api/**, or lib/**) — narrow it to the specific feature ` +
      `(e.g. "Scope: ${rel.replace(/[^/]+$/, "**")}") so it counts.`
    : cover.sawExpiredMatch
      ? ` A blueprint whose Scope matches '${rel}' is an EXPIRED stub (past its ` +
        `"Expires:" date) — refresh it (or write a full blueprint) so it counts.`
      : "";

  // WHAT is missing + HOW to satisfy it — identical in both tiers, so the discipline
  // survives the downgrade; only the enforcement verb changes (C3).
  const what =
    `'${rel}' is new feature code with no blueprint covering it ` +
    `(ADR-033; CLAUDE.md "Blueprint before building").${hygiene}`;
  const how =
    ` Run /blueprint FIRST: pin down user stories, happy + worst-path scenarios, and ` +
    `resolve open questions with AskUserQuestion (don't guess the requirements). Then ` +
    `ensure the blueprint carries a "Scope:" line covering this file — e.g. ` +
    `"Scope: ${rel.replace(/[^/]+$/, "**")}". Lightweight/quickstart work still writes ` +
    `a minimal Scope'd stub under docs/blueprints/. The blueprint is the contract ` +
    `/qa and /uat trace against; building without it is the rebuild this gate prevents.`;

  console.log(
    JSON.stringify(
      isSharedTier(ROOT)
        ? {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `[blueprint-gate] Denied: ${what}${how}`,
            },
          }
        : {
            // Advisory path (personal / disposable tier): nudge, don't block — same
            // `additionalContext`-only contract as rules-injection.mjs.
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext:
                `[blueprint-gate] ADVISORY — allowed, not blocked (project.config.json ` +
                `tier is "personal"/unset, so /quickstart keeps its idea→URL speed): ` +
                `${what}${how} Write the Scope'd stub before this ships; on a ` +
                `"tier": "shared" project this same write is DENIED.`,
            },
          },
    ),
  );
} catch {
  // fail-open RETAINED (WS-8 audit): governance gate, not a security guard — a hook error must not block all writes; only the security guards (protect-secrets, dangerous-commands) fail closed.
  /* fail-open: never brick the session */
}
process.exit(0);
