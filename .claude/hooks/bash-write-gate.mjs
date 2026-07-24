#!/usr/bin/env node
// PreToolUse hook (Bash matcher) -- the Bash write-gate (harness-v2 V2-001).
//
// Problem it solves: blueprint-gate.mjs and build-vs-buy-gate.mjs only see the Write/Edit
// tools. A model can bypass both by dropping to the shell -- `bash -c 'cat >
// app/api/x/route.ts <<EOF ... EOF'` writes new feature code the Write-tool gates would
// have denied. This hook closes that hole: it detects shell writes whose resolved target
// lands on a gated surface and applies the SAME coverage checks (shared scope-cover.mjs)
// the Write hooks apply -- a blueprint Scope for new routes/pages, a ledger Scope for new
// lib/ capabilities.
//
// Detected write forms: redirection (`>`, `>>`, fd-prefixed, heredoc `cat > f <<EOF`),
// `tee`, `cp`/`mv` into the repo, and `sed -i` file targets.
//
// Fail-open (governance convention, matching the Write gates and NOT the fail-closed
// dangerous-commands.mjs / protect-secrets.mjs security guards): any parse/internal error
// stays silent and ALLOWS. It never denies a legitimate write on error, and it does not
// touch the destructive-command logic in dangerous-commands.mjs (a sibling Bash hook).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  relPath,
  isFeatureFile,
  isGatedCapabilityFile,
  blueprintCoverInfo,
  ledgerCoverInfo,
} from "./lib/scope-cover.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Strip one layer of matching surrounding quotes from a shell token. */
function unquote(tok) {
  const t = tok.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Is this token an option flag (leading `-`) rather than a path operand? */
const isFlag = (t) => t.startsWith("-");

/**
 * Collect candidate write-target paths from a shell command string. Best-effort by
 * design: a false miss is caught by the Write-tool gates; a false hit only affects gated
 * repo paths (a non-repo target resolves outside ROOT and is ignored downstream).
 */
function writeTargets(command) {
  const targets = new Set();
  const cmd = String(command ?? "");

  // 1. Redirections: `>`/`>>`, optionally fd-prefixed (`2>`, `1>>`). Captures the path
  //    token that follows. Also catches heredoc redirection (`cat > f <<EOF`).
  const redir = /(?:^|[\s;|&(])\d*>>?\s*("[^"]*"|'[^']*'|[^\s;|&<>()]+)/g;
  for (const m of cmd.matchAll(redir)) {
    const p = unquote(m[1]);
    if (p && p !== "&1" && p !== "&2" && !p.startsWith("/dev/")) targets.add(p);
  }

  // 2. Split into command segments to scan tee/cp/mv/sed as leading verbs.
  for (const rawSeg of cmd.split(/\||&&|\|\||;|\n/)) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    // tokenize on whitespace, respecting simple quotes
    const toks = seg.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
    // drop leading env-assignments (VAR=val) and `sudo`
    let i = 0;
    while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || toks[i] === "sudo")) i++;
    const verb = (toks[i] ?? "").replace(/^.*\//, ""); // basename of the command
    const operands = toks.slice(i + 1).map(unquote);

    if (verb === "touch") {
      // `touch app/api/x/route.ts` CREATES the file, then a follow-up Write sees an
      // existing file and the Write-tool gates exempt it -> a two-step bypass of the
      // blueprint/ledger gate (V2 challenge-audit M3). Treat every non-flag operand as a
      // gated write target so the create itself is checked.
      for (const o of operands) if (!isFlag(o)) targets.add(o);
    } else if (verb === "tee") {
      for (const o of operands) if (!isFlag(o)) targets.add(o);
    } else if (verb === "cp" || verb === "mv") {
      // destination is the last non-flag operand
      const nonFlag = operands.filter((o) => !isFlag(o));
      if (nonFlag.length >= 2) targets.add(nonFlag.at(-1));
    } else if (verb === "sed") {
      // `sed -i ... file...` — treat trailing non-flag operands as in-place targets
      const hasInPlace = operands.some((o) => o === "-i" || /^-i/.test(o) || o === "--in-place");
      if (hasInPlace) for (const o of operands) if (!isFlag(o)) targets.add(o);
    }
  }
  return [...targets];
}

/** First gated target lacking coverage, or null if every write is fine. */
function firstUncoveredViolation(command) {
  for (const raw of writeTargets(command)) {
    const rel = relPath(raw, ROOT);
    if (!rel || rel.startsWith("..")) continue; // outside the repo
    // Overwrite of an EXISTING file = a continuation, not a fresh build -> don't gate.
    // Mirrors the Write-tool gates (blueprint-gate.mjs / build-vs-buy-gate.mjs), which
    // exempt existing files; without this, sed -i / tee / cat> on already-shipped gated
    // files (e.g. lib/api-helpers.ts, existing routes) would false-deny routine edits.
    if (existsSync(resolve(ROOT, raw))) continue;
    if (isFeatureFile(rel)) {
      const cover = blueprintCoverInfo(rel, ROOT);
      if (!cover.covered) return { rel, kind: "blueprint", cover };
    } else if (isGatedCapabilityFile(rel)) {
      const cover = ledgerCoverInfo(rel, ROOT);
      if (!cover.covered) return { rel, kind: "ledger", cover };
    }
  }
  return null;
}

function blueprintReason(rel, cover) {
  const hygiene = cover?.sawBroadMatch
    ? ` A blueprint's Scope glob matches '${rel}' but is TOO BROAD (a whole structural ` +
      `root like app/**, app/api/**, or lib/**) — narrow it to the specific feature so it counts.`
    : cover?.sawExpiredMatch
      ? ` A blueprint whose Scope matches '${rel}' is an EXPIRED stub — refresh it so it counts.`
      : "";
  return (
    `[blueprint-gate] Denied (via bash-write-gate): the shell command writes '${rel}', ` +
    `new feature code with no blueprint covering it (ADR-033; CLAUDE.md "Blueprint before ` +
    `building").${hygiene} Dropping to Bash does not bypass the gate. Run /blueprint FIRST ` +
    `(user stories + happy/worst scenarios + open questions via AskUserQuestion), then add a ` +
    `"Scope:" line covering this file — e.g. "Scope: ${rel.replace(/[^/]+$/, "**")}".`
  );
}

function ledgerReason(rel, cover) {
  const hygiene = cover?.sawBroadMatch
    ? ` A ledger Scope matches '${rel}' but is TOO BROAD (a fork-wide lib/** / components/shared/** ` +
      `/ scripts/** entry is a rubber stamp) — add a SPECIFIC entry for this path.`
    : cover?.sawScopeWithoutConsidered
      ? ` A ledger Scope matches '${rel}' but its entry has no "Considered:" line — add one naming ` +
        `>=1 alternative you weighed (V2-309 requires it).`
      : "";
  return (
    `[build-vs-buy] Denied (via bash-write-gate): the shell command writes '${rel}', a NEW ` +
    `hand-built capability (lib/, components/shared/, or scripts/ — V2-309) with no build-vs-buy ` +
    `decision covering it (ADR-032; CLAUDE.md "Market benchmark before building").${hygiene} ` +
    `Dropping to Bash does not bypass the gate. Do the reuse scan — step 0 is docs/oss-catalog.md ` +
    `(the seeded reuse catalog; or run /adopt <capability>, which reads it) — then record a ` +
    `"### <date> - <capability>" entry in docs/build-vs-buy-ledger.md with a ` +
    `"Scope: ${rel.replace(/[^/]+$/, "**")}" glob AND a "Considered:" line naming >=1 alternative ` +
    `you weighed (V2-309 requires it).`
  );
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if ((input.tool_name ?? "") !== "Bash") process.exit(0);
  const command = input.tool_input?.command ?? "";
  const v = firstUncoveredViolation(command);
  if (v) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            v.kind === "blueprint" ? blueprintReason(v.rel, v.cover) : ledgerReason(v.rel, v.cover),
        },
      }),
    );
  }
} catch {
  // fail-open: a governance gate must never brick the session (matches the Write gates;
  // the fail-closed security guards are protect-secrets.mjs + dangerous-commands.mjs).
}
process.exit(0);
