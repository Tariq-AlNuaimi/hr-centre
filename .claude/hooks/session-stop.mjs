#!/usr/bin/env node
// Stop hook -- guard against losing work between sessions (complaint #14).
//
// Fresh remote containers clone ONLY what has been pushed. Committed-but-unpushed
// commits AND uncommitted working-tree changes both vanish when the container is
// reclaimed -- which is exactly how "I built it / seeded it last session but the
// next session has no record of it" happens.
//
// This fires when the main agent finishes a turn. Two tiers (the operator's
// "tiered blocking gate · hard hooks" decision):
//   - UNPUSHED COMMITS are a hard BLOCK. Committed work that is never pushed is
//     the silent data-loss case (a fresh container clones only what's pushed), so
//     the hook emits {"decision":"block", reason} ONCE to stop the turn ending
//     until the work is pushed. The block is guarded by `stop_hook_active` so it
//     fires at most once per stop attempt — never an infinite stop→block→stop loop.
//   - UNCOMMITTED working-tree changes stay a non-blocking WARN: a hard block
//     there would trap the agent mid-conversation before it can even commit, and
//     WIP is legitimately transient. It's surfaced as a loud, deduped reminder
//     whenever the state CHANGES, so it can't be missed over a session.
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (git("rev-parse --is-inside-work-tree") !== "true") process.exit(0);

  const branch = git("rev-parse --abbrev-ref HEAD") || "?";
  const dirty = git("status --porcelain"); // tracked + untracked, uncommitted
  const upstream = git("rev-parse --abbrev-ref --symbolic-full-name @{u}");
  const hasUpstream = !!upstream;
  const ahead = hasUpstream ? Number(git("rev-list --count @{u}..HEAD") || "0") : 0;
  const localCommits = Number(git("rev-list --count HEAD") || "0");

  // BLOCK tier: committed-but-unpushed work (the silent data-loss case).
  const blockers = [];
  if (ahead > 0) blockers.push(`${ahead} commit(s) on '${branch}' are NOT pushed`);
  if (!hasUpstream && localCommits > 0)
    blockers.push(`'${branch}' has no upstream — nothing on this branch is pushed`);
  // WARN tier: uncommitted working-tree changes.
  const warnings = [];
  if (dirty) warnings.push(`${dirty.split("\n").length} uncommitted change(s) in the working tree`);

  const fix = `git add -A && git commit -m "<msg>" && git push -u origin ${branch}`;

  // --- BLOCK on unpushed commits (once per stop attempt) -------------------
  // `stop_hook_active` is true when this Stop fires *because* a prior block made
  // the agent continue — blocking again there is the infinite-loop case the
  // protocol warns about, so we degrade to a warning instead.
  if (blockers.length > 0 && !input.stop_hook_active) {
    const reason =
      "Refusing to end the session with unpushed commits — a fresh container " +
      "clones only what is pushed, so these would be lost (#14):\n" +
      blockers.map((p) => `  - ${p}`).join("\n") +
      (warnings.length ? "\n" + warnings.map((w) => `  - ${w}`).join("\n") : "") +
      `\nPush now (or run /handoff-session, which verifies its push):\n  ${fix}`;
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(0);
  }

  const problems = [...blockers, ...warnings];
  const stateFile = `/tmp/session-guard-${input.session_id ?? "s"}`;
  if (problems.length === 0) {
    // clean — say nothing, and GC the per-session dedup marker so /tmp doesn't
    // accumulate stale markers across sessions.
    try {
      if (existsSync(stateFile)) unlinkSync(stateFile);
    } catch {}
    process.exit(0);
  }

  // WARN path (uncommitted-only, or already-blocked-once). Dedupe: only re-warn
  // when the state signature changes, so a long session isn't spammed every turn.
  const sig = `${branch}|${ahead}|${hasUpstream ? 1 : 0}|${dirty ? dirty.split("\n").length : 0}`;
  const last = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : "";
  if (last === sig) process.exit(0);
  writeFileSync(stateFile, sig);

  console.error(
    `[session-guard] Work is only safe once PUSHED — a fresh container clones nothing else (#14):\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      `\n  Commit + push completed work (or run /handoff-session) before this session ends:\n    ${fix}`,
  );
} catch {
  /* a hook must never trap the agent */
}
process.exit(0);
