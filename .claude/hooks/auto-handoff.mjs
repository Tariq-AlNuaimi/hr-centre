#!/usr/bin/env node
// auto-handoff hook -- Part 2 of session-automation (blueprint:
// docs/blueprints/session-automation-auto-handoff.md).
//
// Keeps docs/SESSION-HANDOFF.md's status tables current from docs/session-state.json:
//   1. re-renders the marked auto-status block (delegated to scripts/render-handoff.mjs;
//      marked-region merge leaves all operator prose intact). This is a NO-OP when the
//      handoff is already in sync, so it never gratuitously dirties the tree.
//   2. surfaces whether the branch is pushed (@{u}..HEAD == 0) so the operator knows
//      the handoff is durable.
//   3. Part 3: asks the auto-spawn guard whether a successor may be scheduled and, only
//      when PERMITTED, writes the request signal + prints the create_trigger params.
//
// This hook does NOT mutate lastShip: /ship owns the green-for-HEAD signal (the
// gitignored .claude/state/last-green-sha it writes for the exact tree it verified),
// and the guard reads THAT. Writing lastShip here from a SessionEnd hook would be
// non-durable anyway (a fresh remote container clones only committed+pushed state) and
// would only add working-tree drift -- so we don't.
//
// Wired to SessionEnd (operator's Q3: SessionEnd + watchdog-80%, NOT every Stop). The
// context-watchdog invokes the same render at its 80% threshold. Fail-open by contract:
// every path exits 0, and the render runs with RENDER_HANDOFF_SOFT=1 so it can never
// trap the session end.
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

  // 1. Re-render the handoff tables from the JSON (soft: never trap). No-op when in sync.
  const r = spawnSync("node", [join(ROOT, "scripts", "render-handoff.mjs")], {
    env: { ...process.env, RENDER_HANDOFF_SOFT: "1" },
    encoding: "utf8",
  });

  // 2. Durability line. `hasUpstream` and the ahead-count are read separately so a
  //    failed rev-list (returns "") can't be mistaken for "0 ahead / pushed".
  const hasUpstream = git("rev-parse --abbrev-ref --symbolic-full-name @{u}") !== "";
  const aheadRaw = hasUpstream ? git("rev-list --count @{u}..HEAD") : "";
  const notice =
    "[auto-handoff] SESSION-HANDOFF.md tables re-rendered from docs/session-state.json." +
    (!hasUpstream
      ? " WARNING: branch has no upstream — nothing is pushed."
      : aheadRaw === ""
      ? " NOTE: could not determine push status (git rev-list failed)."
      : Number(aheadRaw) > 0
      ? ` WARNING: ${aheadRaw} commit(s) unpushed — the handoff is not yet durable (push before the container is reclaimed).`
      : " Branch is pushed — handoff is durable.");
  console.error(notice + (r.stderr ? `\n${r.stderr.trim()}` : ""));

  // 3. Part 3 -- guarded auto-spawn (disabled by default). Ask the guard whether a
  // successor session may be scheduled. IMPORTANT (honest scope): a SessionEnd hook
  // cannot call the Claude Code Remote MCP, and SessionEnd is terminal (no further
  // agent turn in THIS session), so this does NOT autonomously spawn. When PERMITTED
  // it writes a request signal + prints the exact create_trigger params as a
  // copy-pasteable next step for the operator (or for the agent to fire in its LAST
  // turn before ending, which IS able to call the MCP). True zero-touch spawn needs
  // that explicit firing step + a --record call; there is no background consumer yet.
  // When the guard ships disabled (autoSpawn.enabled=false), this is always BLOCKED
  // -> fully inert.
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
        // The standing prompt a successor session should start with. A spawned
        // session boots on a fresh clone of the DEFAULT branch (main), so it MUST
        // fetch + checkout this working branch first — the program handoff + state
        // live only on it. Omitting this was the 2026-07-03 auto-spawn failure.
        prompt:
          `You are an AUTO-SPAWNED successor for the ${state.program} program. You boot on a ` +
          `fresh clone of the DEFAULT branch, so FIRST run:\n` +
          `  git fetch origin ${branch} && git checkout -B ${branch} origin/${branch}\n` +
          `(the handoff + docs/session-state.json live only on that branch, never on main). ` +
          `THEN read docs/SESSION-HANDOFF.md FIRST and show BOTH status tables ` +
          `(compact IN PROGRESS/REMAINING + the full GRAND PROGRESS TABLE), then continue at Next actions.`,
      };
      writeFileSync(join(stateDir, "auto-spawn-request.json"), JSON.stringify(req, null, 2) + "\n");
      console.error(
        "[auto-handoff] auto-spawn PERMITTED (guardrails passed). Wrote .claude/state/auto-spawn-request.json.\n" +
          "  CONSUMER: from a LIVE turn (agent closeout — SessionEnd itself cannot call MCP), run\n" +
          "    node scripts/auto-spawn-fire.mjs\n" +
          "  and pass its CREATE_TRIGGER_PAYLOAD to mcp__Claude_Code_Remote__create_trigger. That\n" +
          "  script re-checks the guard, prints the exact payload, and records the spawn against the cap."
      );
    } catch { /* best-effort signal */ }
  }
} catch { /* a hook must never trap the agent */ }
process.exit(0);
