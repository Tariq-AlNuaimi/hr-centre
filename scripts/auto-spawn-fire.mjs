#!/usr/bin/env node
// auto-spawn-fire.mjs -- the auto-spawn CONSUMER (session-automation Part 3).
//
// A hook/script cannot call the Claude Code Remote MCP (`create_trigger`), and the
// SessionEnd hook is terminal. So the one component that CAN schedule a successor is
// the agent, in a live turn, at closeout. This script is the turnkey closeout step it
// runs: it re-checks the guard and, when PERMITTED, prints the EXACT create_trigger
// tool-call payload (JSON) for the agent to pass straight to the MCP tool, then records
// the spawn against the consecutive cap. That closes the "guard decides -> agent fires"
// loop with the agent as the deliberate, cap-limited firer.
//
// Closeout contract (document this wherever a session ends autonomously):
//   1. Push all work; run /ship green (writes .claude/state/last-green-sha at HEAD).
//   2. Run:  node scripts/auto-spawn-fire.mjs
//   3. If it prints a `CREATE_TRIGGER_PAYLOAD` block, call the MCP tool
//      mcp__Claude_Code_Remote__create_trigger with exactly those args (it fires a
//      fresh session whose prompt is the standing directive). The script has already
//      recorded the spawn (--record) so the cap is enforced. If it prints BLOCKED,
//      do nothing -- end the session normally.
//
// Safety: this only prints a payload when auto-spawn-guard.mjs PERMITS (enabled +
// pushed + green-for-HEAD + under cap). Ships inert because autoSpawn.enabled=false by
// default. Idempotency is the agent's responsibility -- run it once at closeout.
import { readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "docs", "session-state.json");
const GUARD = join(ROOT, "scripts", "auto-spawn-guard.mjs");

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// 1. Guard.
const g = spawnSync("node", [GUARD], { encoding: "utf8" });
if (g.status !== 0) {
  process.stdout.write("AUTO-SPAWN BLOCKED — not scheduling a successor.\n");
  if (g.stdout) process.stdout.write(g.stdout);
  process.exit(0); // BLOCKED is a normal, non-error outcome
}

// 2. Build the create_trigger payload.
let program = "the program";
try {
  program = JSON.parse(readFileSync(STATE, "utf8")).program || program;
} catch {}
const branch = git("rev-parse --abbrev-ref HEAD") || "the working branch";
// A spawned session (create_new_session_on_fire) boots on a FRESH clone of the
// repo's DEFAULT branch (main), NOT this working branch — the successor must
// explicitly fetch + checkout it before anything else, because the program's
// handoff + state files live ONLY on the working branch (never merged to main).
// Omitting this was the 2026-07-03 auto-spawn failure: the trigger fired, but the
// successor (if it booted at all) landed on main with no program context and did
// no work. See docs/blueprints/session-automation-auto-handoff.md "Auto-spawn
// failure (2026-07-03) — root cause + fix".
const prompt =
  `You are an AUTO-SPAWNED successor session for the ${program} program. You boot on a ` +
  `fresh clone of the DEFAULT branch, so your FIRST action MUST be to get onto this ` +
  `program's working branch:\n` +
  `  git fetch origin ${branch} && git checkout -B ${branch} origin/${branch}\n` +
  `(the handoff + docs/session-state.json live only on that branch, never on main). ` +
  `THEN read docs/SESSION-HANDOFF.md FIRST and show BOTH status tables (the compact ` +
  `IN PROGRESS/REMAINING table and the full GRAND PROGRESS TABLE), then continue at ` +
  `Next actions. Follow the handoff's LESSONS + OPERATOR DIRECTIVES. If a human ` +
  `re-engages, run \`node scripts/auto-spawn-guard.mjs --reset\` to re-arm the cap. ` +
  `End with /ship green, pushed, and the handoff updated.`;
const payload = {
  name: `auto-continue: ${program}`,
  create_new_session_on_fire: true,
  prompt,
};

// 3. Record the spawn against the consecutive cap BEFORE handing the payload back, so a
//    crash after firing can't under-count (fail toward blocking, not runaway).
const rec = spawnSync("node", [GUARD, "--record"], { encoding: "utf8" });

process.stdout.write("AUTO-SPAWN PERMITTED — call mcp__Claude_Code_Remote__create_trigger with:\n");
process.stdout.write("CREATE_TRIGGER_PAYLOAD\n");
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
process.stdout.write("END_PAYLOAD\n");
if (rec.stderr) process.stderr.write(rec.stderr);
process.stdout.write(
  "\nRecorded against the consecutive-spawn cap. After a human re-engages, run:\n" +
    "  node scripts/auto-spawn-guard.mjs --reset\n",
);
process.exit(0);
