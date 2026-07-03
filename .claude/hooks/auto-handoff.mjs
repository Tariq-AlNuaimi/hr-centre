#!/usr/bin/env node
// auto-handoff hook -- Part 2 of session-automation (blueprint:
// docs/blueprints/session-automation-auto-handoff.md).
//
// Guarantees docs/SESSION-HANDOFF.md's status tables are ALWAYS current without
// the session having to remember to run /handoff-session. It:
//   1. stamps docs/session-state.json `lastShip` sha/date from the working tree
//      (status is left as-is -- only /ship knows green/red -- but the sha/date
//      are refreshed so a fresh session sees the real HEAD),
//   2. re-renders the marked auto-status block in SESSION-HANDOFF.md from the JSON
//      (delegated to scripts/render-handoff.mjs; marked-region merge leaves all
//      operator prose intact),
//   3. surfaces whether the branch is pushed (@{u}..HEAD == 0) so the operator
//      knows the handoff is durable.
//
// Wired to SessionEnd (operator's Q3 answer: SessionEnd + watchdog-80%, NOT every
// Stop -- too chatty). The context-watchdog invokes the same render at its 80%
// threshold. Fail-open by contract: every path exits 0, and the render is run
// with RENDER_HANDOFF_SOFT=1 so it can never trap the session end.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || ".";
const STATE = join(ROOT, "docs", "session-state.json");

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

try {
  try { readFileSync(0, "utf8"); } catch {} // drain stdin; payload not needed

  if (git("rev-parse --is-inside-work-tree") !== "true") process.exit(0);
  if (!existsSync(STATE)) process.exit(0);

  // 1. Reconcile lastShip with the real HEAD. Only /ship earns green (it stamps
  //    lastShip green for the exact sha it verified). If HEAD has moved PAST that
  //    sha, the tree is no longer known-green, so INVALIDATE the status to
  //    "unknown" while updating the sha. This is what keeps the auto-spawn guard's
  //    "green for current HEAD" check honest: a stray commit after a green ship
  //    can never masquerade as green and permit an unverified successor.
  const sha = git("rev-parse --short HEAD");
  if (sha) {
    try {
      const state = JSON.parse(readFileSync(STATE, "utf8"));
      state.lastShip = state.lastShip || {};
      if (state.lastShip.sha !== sha) {
        state.lastShip.sha = sha;
        state.lastShip.status = "unknown"; // HEAD moved without a re-ship
        writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
      }
    } catch { /* leave the file untouched on any parse error */ }
  }

  // 2. Re-render the handoff tables from the JSON (soft: never trap).
  const r = spawnSync("node", [join(ROOT, "scripts", "render-handoff.mjs")], {
    env: { ...process.env, RENDER_HANDOFF_SOFT: "1" },
    encoding: "utf8",
  });

  // 3. Durability line.
  const upstream = git("rev-parse --abbrev-ref --symbolic-full-name @{u}");
  const ahead = upstream ? Number(git("rev-list --count @{u}..HEAD") || "0") : null;
  const notice =
    "[auto-handoff] SESSION-HANDOFF.md tables re-rendered from docs/session-state.json." +
    (upstream === ""
      ? " WARNING: branch has no upstream — nothing is pushed."
      : ahead > 0
      ? ` WARNING: ${ahead} commit(s) unpushed — the handoff is not yet durable (push before the container is reclaimed).`
      : " Branch is pushed — handoff is durable.");
  console.error(notice + (r.stderr ? `\n${r.stderr.trim()}` : ""));

  // 4. Part 3 -- guarded auto-spawn (disabled by default). Ask the guard whether a
  // successor session may be scheduled. Hooks cannot call the Claude Code Remote
  // MCP, so when PERMITTED we only write a request signal + print the exact
  // create_trigger parameters; the agent (or operator) fires it. When the guard
  // ships disabled (autoSpawn.enabled=false), this is always BLOCKED -> inert.
  const g = spawnSync("node", [join(ROOT, "scripts", "auto-spawn-guard.mjs")], { encoding: "utf8" });
  if (g.status === 0) {
    try {
      const state = JSON.parse(readFileSync(STATE, "utf8"));
      const branch = git("rev-parse --abbrev-ref HEAD");
      const stateDir = join(ROOT, ".claude", "state");
      mkdirSync(stateDir, { recursive: true });
      const req = {
        branch,
        head: git("rev-parse --short HEAD"),
        program: state.program,
        // The standing prompt a successor session should start with.
        prompt:
          `Continue the ${state.program} program on branch ${branch}. ` +
          `Read docs/SESSION-HANDOFF.md FIRST and show BOTH status tables ` +
          `(compact IN PROGRESS/REMAINING + the full GRAND PROGRESS TABLE), then continue at Next actions.`,
      };
      writeFileSync(join(stateDir, "auto-spawn-request.json"), JSON.stringify(req, null, 2) + "\n");
      console.error(
        "[auto-handoff] auto-spawn PERMITTED. Wrote .claude/state/auto-spawn-request.json.\n" +
          "  To schedule the successor, the agent fires create_trigger (Claude Code Remote MCP):\n" +
          `    create_trigger({ name: "auto-continue ${req.program}", create_new_session_on_fire: true,\n` +
          `      run_once_at: "<+2min RFC3339>", prompt: <request.prompt> })\n` +
          "  Then run: node scripts/auto-spawn-guard.mjs --record  (increments the consecutive-spawn counter)."
      );
    } catch { /* best-effort signal */ }
  }
} catch { /* a hook must never trap the agent */ }
process.exit(0);
