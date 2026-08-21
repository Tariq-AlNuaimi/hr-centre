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
//
// C3 (tiered friction): this hook MIRRORS the two Write-tool gates, so it mirrors their
// tiering too — `"tier": "shared"` in project.config.json keeps the hard
// `permissionDecision: "deny"`; the `"personal"` default emits an advisory
// `additionalContext` instead. Keeping the tiering identical is the whole point: dropping
// to Bash must be neither a bypass (looser) nor a trap (stricter) versus Write/Edit.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  relPath,
  isFeatureFile,
  isGatedCapabilityFile,
  blueprintCoverInfo,
  ledgerCoverInfo,
  isSharedTier,
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
// Runners whose heredoc body is a SCRIPT, not data -- see stripHeredocBodies.
const INTERPRETER_VERBS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "node",
  "nodejs",
  "npx",
  "tsx",
  "ts-node",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
]);

/**
 * Remove heredoc BODIES, keeping the command line that opens them.
 *
 * V2-001 false-positive (register 2026-07-16, hit repeatedly in practice): the
 * redirection scan ran over the WHOLE command string, so a heredoc whose CONTENT merely
 * mentioned a gated path -- a commit message, a doc, an example -- was read as a write to
 * it and denied. The opening line (`cat > f <<EOF`) is a real redirection and is kept;
 * everything between it and the terminator is DATA and must never be scanned.
 */
function stripHeredocBodies(cmd, depth = 0) {
  const lines = cmd.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    // <<EOF | <<-EOF | <<"EOF" | <<'EOF' -- possibly several on one line.
    const opens = [...line.matchAll(/<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/g)].map((m) => m[2]);
    // A heredoc body is inert DATA only when something CONSUMES it (`cat > f <<EOF`).
    // When it is fed to an INTERPRETER the body is a script, so stripping it hid real
    // writes. Round 11 fixed that by checking the line's FIRST word -- which only ever
    // recognised `bash <<'OUTER'` and missed every indirect delivery of the same body:
    // `cat <<'OUTER' | bash` has first word `cat`, and bash still executes the body.
    // Ask the semantic question instead: does ANY stage of this line's pipeline run an
    // interpreter? Conservative on purpose -- a false "executed" only means the body
    // gets scanned, and nested DATA bodies inside it are still stripped by the
    // recursion below.
    const bodyIsExecuted = line
      .split(/\||&&|;/)
      .some((seg) =>
        INTERPRETER_VERBS.has((seg.trim().split(/\s+/)[0] ?? "").replace(/^.*\//, "")),
      );
    i++;
    for (const tag of opens) {
      const body = [];
      while (i < lines.length && lines[i].trim() !== tag) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the terminator itself
      // Keeping an executed body must NOT keep the data bodies nested inside it.
      // Round 11 copied the body verbatim, which swept a nested `cat > f <<'X'`'s
      // CONTENT back into the scanned text -- resurrecting the exact false positive
      // stripHeredocBodies exists to prevent, this time for interpreter heredocs.
      if (bodyIsExecuted && depth < 4) out.push(stripHeredocBodies(body.join("\n"), depth + 1));
    }
  }
  return out.join("\n");
}

/**
 * Redirection targets, found by a QUOTE-AWARE scan.
 *
 * The regex this replaces matched `>` anywhere, including inside a quoted string, so
 * `git commit -m "writes > app/api/x/route.ts"` denied. A `>` only redirects when it is
 * outside quotes; one inside them is text.
 */
function redirectionTargets(cmd) {
  const found = [];
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c !== ">") continue;
    // `<<` / `<<<` are inputs, and `>` inside `<>` is not ours; also skip `>&`.
    let j = i + 1;
    if (cmd[j] === ">") j++;
    if (cmd[j] === "&") continue;
    while (j < cmd.length && (cmd[j] === " " || cmd[j] === "\t")) j++;
    // Read the target token, honouring quotes around it.
    let tok = "";
    if (cmd[j] === '"' || cmd[j] === "'") {
      const q = cmd[j++];
      while (j < cmd.length && cmd[j] !== q) tok += cmd[j++];
    } else {
      while (j < cmd.length && !/[\s;|&<>()]/.test(cmd[j])) tok += cmd[j++];
    }
    if (tok && !tok.startsWith("/dev/") && tok !== "&1" && tok !== "&2") found.push(tok);
    i = j - 1;
  }
  return found;
}

/**
 * Simple `VAR=value` assignments in the command, so `$VAR` in a target can be resolved.
 *
 * V2-001 evasion (register 2026-07-16): `F=app/api/x/route.ts; cat > "$F"` wrote a new
 * gated file with no literal path anywhere a scanner looked. Only literal, single-line
 * assignments are resolved -- enough to close the hand-written bypass without pretending
 * to be a shell.
 */
function shellVars(cmd) {
  const vars = new Map();
  for (const m of cmd.matchAll(
    /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;|&<>()]*)/g,
  )) {
    vars.set(m[1], unquote(m[2]));
  }
  return vars;
}

/** Expand `$VAR` / `${VAR}` from the collected assignments. Unknown names expand to "". */
function expandVars(tok, vars) {
  return tok.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, a, b) => vars.get(a ?? b) ?? "",
  );
}

// Runners that can write a file from a one-liner, and the write calls worth noticing.
const WRITE_RUNNERS = new Set([
  "node",
  "nodejs",
  "npx",
  "tsx",
  "ts-node",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
]);
const WRITE_CALL =
  /\b(writeFileSync|appendFileSync|createWriteStream|writeFile|outputFileSync|mkdirSync|write_text|open\s*\()/;

/**
 * Paths written by an interpreter one-liner.
 *
 * V2-001 evasion: `node -e "require('fs').writeFileSync('app/api/x/route.ts', …)"` creates
 * a gated file without a single redirect token. Only string literals that look like repo
 * paths are considered, and only when the body also contains a write call -- so a
 * one-liner that merely READS or prints a path is untouched.
 */
function interpreterTargets(cmd) {
  const found = [];
  for (const seg of cmd.split(/\||&&|\|\||;|\n/)) {
    const toks = seg.trim().match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
    let i = 0;
    while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || toks[i] === "sudo")) i++;
    const verb = (toks[i] ?? "").replace(/^.*\//, "");
    if (!WRITE_RUNNERS.has(verb)) continue;
    const flagAt = toks.findIndex((t) => t === "-e" || t === "-c" || t === "--eval");
    if (flagAt === -1) continue;
    const body = toks.slice(flagAt + 1).join(" ");
    if (!WRITE_CALL.test(body)) continue;
    for (const m of body.matchAll(/["'`]([^"'`]+\.[A-Za-z0-9]{1,5})["'`]/g)) found.push(m[1]);
  }
  return found;
}

function writeTargets(command) {
  const targets = new Set();
  // Heredoc BODIES are data, never commands -- strip them before anything scans for writes.
  const cmd = stripHeredocBodies(String(command ?? ""));
  const vars = shellVars(cmd);
  const add = (t) => {
    const v = expandVars(unquote(t), vars).trim();
    if (v) targets.add(v);
  };

  // 1. Redirections: `>`/`>>`, fd-prefixed, and the heredoc OPENER (`cat > f <<EOF`).
  for (const t of redirectionTargets(cmd)) add(t);

  // 1b. Interpreter one-liners that call a write API.
  for (const t of interpreterTargets(cmd)) add(t);

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

    if (WRITE_RUNNERS.has(verb)) continue; // handled by interpreterTargets above
    if (verb === "touch") {
      // `touch app/api/x/route.ts` CREATES the file, then a follow-up Write sees an
      // existing file and the Write-tool gates exempt it -> a two-step bypass of the
      // blueprint/ledger gate (V2 challenge-audit M3). Treat every non-flag operand as a
      // gated write target so the create itself is checked.
      for (const o of operands) if (!isFlag(o)) add(o);
    } else if (verb === "tee") {
      for (const o of operands) if (!isFlag(o)) add(o);
    } else if (verb === "cp" || verb === "mv") {
      // destination is the last non-flag operand
      const nonFlag = operands.filter((o) => !isFlag(o));
      if (nonFlag.length >= 2) add(nonFlag.at(-1));
    } else if (verb === "sed") {
      // `sed -i ... file...` — treat trailing non-flag operands as in-place targets
      const hasInPlace = operands.some((o) => o === "-i" || /^-i/.test(o) || o === "--in-place");
      if (hasInPlace) for (const o of operands) if (!isFlag(o)) add(o);
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

// The two body builders below return WHAT is missing + HOW to satisfy it, with NO
// enforcement verb — the caller prefixes "Denied:" or the advisory lead-in (C3), so both
// tiers carry the identical remedy and only the friction level differs.
function blueprintBody(rel, cover) {
  const hygiene = cover?.sawBroadMatch
    ? ` A blueprint's Scope glob matches '${rel}' but is TOO BROAD (a whole structural ` +
      `root like app/**, app/api/**, or lib/**) — narrow it to the specific feature so it counts.`
    : cover?.sawExpiredMatch
      ? ` A blueprint whose Scope matches '${rel}' is an EXPIRED stub — refresh it so it counts.`
      : "";
  return (
    `the shell command writes '${rel}', ` +
    `new feature code with no blueprint covering it (ADR-033; CLAUDE.md "Blueprint before ` +
    `building").${hygiene} Dropping to Bash does not skip this check — the Write-tool gate ` +
    `applies the same one. Run /blueprint FIRST ` +
    `(user stories + happy/worst scenarios + open questions via AskUserQuestion), then add a ` +
    `"Scope:" line covering this file — e.g. "Scope: ${rel.replace(/[^/]+$/, "**")}".`
  );
}

function ledgerBody(rel, cover) {
  const hygiene = cover?.sawBroadMatch
    ? ` A ledger Scope matches '${rel}' but is TOO BROAD (a fork-wide lib/** / components/shared/** ` +
      `/ scripts/** entry is a rubber stamp) — add a SPECIFIC entry for this path.`
    : cover?.sawScopeWithoutConsidered
      ? ` A ledger Scope matches '${rel}' but its entry has no "Considered:" line — add one naming ` +
        `>=1 alternative you weighed (V2-309 requires it).`
      : "";
  return (
    `the shell command writes '${rel}', a NEW ` +
    `hand-built capability (lib/, components/shared/, or scripts/ — V2-309) with no build-vs-buy ` +
    `decision covering it (ADR-032; CLAUDE.md "Market benchmark before building").${hygiene} ` +
    `Dropping to Bash does not skip this check — the Write-tool gate applies the same one. ` +
    `Do the reuse scan — step 0 is docs/oss-catalog.md ` +
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
    const tag = v.kind === "blueprint" ? "[blueprint-gate]" : "[build-vs-buy]";
    const body =
      v.kind === "blueprint" ? blueprintBody(v.rel, v.cover) : ledgerBody(v.rel, v.cover);
    const artifact = v.kind === "blueprint" ? "Scope'd blueprint" : "ledger entry";
    console.log(
      JSON.stringify(
        isSharedTier(ROOT)
          ? {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: `${tag} Denied (via bash-write-gate): ${body}`,
              },
            }
          : {
              // Advisory path (personal / disposable tier): nudge, don't block — mirrors
              // the Write-tool gates exactly, so Bash is neither looser nor stricter.
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext:
                  `${tag} ADVISORY via bash-write-gate — allowed, not blocked ` +
                  `(project.config.json tier is "personal"/unset, so /quickstart keeps its ` +
                  `idea→URL speed): ${body} Record the ${artifact} before this ships; on a ` +
                  `"tier": "shared" project this same write is DENIED.`,
              },
            },
      ),
    );
  }
} catch {
  // fail-open: a governance gate must never brick the session (matches the Write gates;
  // the fail-closed security guards are protect-secrets.mjs + dangerous-commands.mjs).
}
process.exit(0);
