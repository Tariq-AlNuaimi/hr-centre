#!/usr/bin/env node
// PreToolUse hook (Bash matcher) -- verbose-output guard (ADR-019).
// Token-bomb commands are denied WITH the cheaper alternative in the reason, so
// the agent self-corrects in one step. Override: prefix the command with
// VERBOSE=1 when full output is genuinely needed (e.g. debugging the build).
import { readFileSync } from "node:fs";

const QUIET_MARKERS = [
  "| grep",
  "| tail",
  "| head",
  "| wc",
  "--silent",
  "VERBOSE=1",
  "2>/dev/null",
];

const RULES = [
  [
    /^\s*npm test\s*$/,
    "raw `npm test` dumps the full suite. Use `npm run ship` (12-line gate) or `npm test 2>&1 | grep -E '^# (pass|fail)'`.",
  ],
  [
    /^\s*(npm run build|npx? next build)\s*$/,
    "raw build output is thousands of lines. Use `npm run ship`, or append `2>&1 | tail -20`.",
  ],
  [
    /^\s*npm run uat\s*$/,
    "raw UAT output is huge. Append `2>&1 | tail -30` or read the generated report file instead.",
  ],
  [
    /^\s*(npx? )?tsc\b/,
    "raw `tsc` dumps every error at once. Use `npm run ship` (typecheck is phase 1) or append `2>&1 | tail -20`.",
  ],
  [
    /^\s*npm run lint\s*$/,
    "raw lint output can be large. Use `npm run ship`, or append `2>&1 | tail -20`.",
  ],
  [
    /^\s*git log\s*$/,
    "bare `git log` can page the entire history into context. Use `git log --oneline -20` or append `| head`.",
  ],
  [
    /^\s*git diff\s*$/,
    "bare `git diff` can be huge. Scope it (`git diff --stat`, a path) or append `| head`.",
  ],
];
const FOREGROUND_SERVERS = /^\s*(npm run dev|npm start|npx? next (dev|start))\b/;

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cmd = input.tool_input?.command ?? "";
  const quiet = QUIET_MARKERS.some((m) => cmd.includes(m));
  let reason = null;
  if (!quiet)
    for (const [re, r] of RULES)
      if (re.test(cmd)) {
        reason = r;
        break;
      }
  if (!reason && FOREGROUND_SERVERS.test(cmd) && !input.tool_input?.run_in_background) {
    reason =
      "dev servers in the foreground stream logs into context forever. Re-run with run_in_background: true.";
  }
  if (reason) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `[token-guard] ${reason}`,
        },
      }),
    );
  }
} catch {
  /* on any error, stay out of the way */
}
process.exit(0);
