#!/usr/bin/env node
// PreToolUse hook (Edit|Write|MultiEdit matcher) -- the build-vs-buy gate (ADR-032).
//
// Problem it solves: the model's default disposition is to hand-build a capability
// from scratch rather than reach for an existing primitive, a library, or a vetted
// /scale-up recipe. "Market benchmark before building" + "reuse existing primitives"
// were advisory prose (CLAUDE.md) and lost to that default under load. This gate makes
// the reuse scan a HARD checkpoint, the same way /ship and protect-secrets are hard.
//
// What it does: when a NEW capability file is about to be created under lib/ (the exact
// "building it myself" moment), it DENIES the write unless a build-vs-buy decision has
// been recorded in docs/build-vs-buy-ledger.md with a Scope: glob covering that path.
// Recording the decision is not a bypass -- it IS the gate working (you did the scan,
// named what you considered, and chose build-vs-adopt on the record).
//
// Narrow by design (low false-positive friction): fires ONLY on Write of a new file
// under lib/, excluding lib/validations/ (zod is expected hand-written), lib/prisma/
// (Ask-before already forces a pause there), tests, and .d.ts. Edits to existing files,
// API routes, and components never trip it.
//
// Fail-open: on any internal error (unreadable ledger, bad JSON) the hook stays silent
// and allows the write -- a build-quality gate must never brick the session. The ledger
// is tiny and tested (tests/harness or the ADR-032 verification steps).
//
// V2-001 F#3 (senior-review 2026-07-16): the Scope/ledger-coverage logic is now the single
// shared implementation in lib/scope-cover.mjs (relPath / isGatedCapabilityFile / ledgerCovers),
// so this Write-tool gate and the Bash-write gate can never diverge, and V2-309's coming
// ledger-glob hygiene lands in one place. Behavior here is unchanged.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { relPath as relTo, isGatedCapabilityFile, ledgerCoverInfo } from "./lib/scope-cover.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Project-relative, forward-slashed path for a Write target (abs or relative). */
function relPath(fp) {
  return relTo(fp, ROOT);
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if ((input.tool_name ?? "") !== "Write") process.exit(0); // only new-file creation
  const fp = input.tool_input?.file_path ?? "";
  const rel = relPath(fp);
  // Overwriting an existing file = a continuation, not a fresh build -> don't gate.
  if (existsSync(resolve(ROOT, fp))) process.exit(0);
  if (!isGatedCapabilityFile(rel)) process.exit(0);
  const info = ledgerCoverInfo(rel, ROOT);
  if (info.covered) process.exit(0);

  // A Scope matched but the entry named no alternatives (V2-309) → a targeted message.
  const reason = info.sawScopeWithoutConsidered
    ? `[build-vs-buy] Denied: '${rel}' has a matching Scope in docs/build-vs-buy-ledger.md, ` +
      `but that entry has no "Considered:" line — a bare Scope is not a build-vs-buy decision ` +
      `(V2-309/ADR-032). Add a "Considered:" line naming >=1 real alternative you weighed ` +
      `(an existing primitive, a /scale-up recipe, an OSS/library option from ` +
      `docs/oss-catalog.md) and why you chose build-vs-adopt. Recording it is not a bypass; ` +
      `it IS the gate.`
    : `[build-vs-buy] Denied: '${rel}' is a NEW hand-built capability (lib/, ` +
      `components/shared/, or scripts/ — V2-309), but no build-vs-buy decision covers it. Do ` +
      `the reuse scan BEFORE writing (ADR-032; CLAUDE.md "Market benchmark before building"): ` +
      `(0) check docs/oss-catalog.md -- the seeded reuse catalog, step 0 (or run /adopt ` +
      `<capability>, which reads it); (1) check docs/REPO-MAP.md and lib/ + components/shared/ ` +
      `for an existing primitive; (2) check the /scale-up recipe table; (3) web-search for a ` +
      `library/open-source fit. Then record the decision in docs/build-vs-buy-ledger.md -- a ` +
      `"### <date> - <capability>" entry with a "Scope: ${rel.replace(/[^/]+$/, "**")}" glob, ` +
      `a "Considered:" line naming the options, and why you're building vs adopting. Recording ` +
      `it is not a bypass; it IS the gate. If a full blueprint applies, run /blueprint first.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
} catch {
  // fail-open RETAINED (WS-8 audit): governance gate, not a security guard — a hook error must not block all writes; only the security guards (protect-secrets, dangerous-commands) fail closed.
  /* fail-open: a build-quality gate must never brick the session */
}
process.exit(0);
