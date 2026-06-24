#!/usr/bin/env node
// Stop hook -- guard against losing work between sessions (complaint #14).
//
// Fresh remote containers clone ONLY what has been pushed. Committed-but-unpushed
// commits AND uncommitted working-tree changes both vanish when the container is
// reclaimed -- which is exactly how "I built it / seeded it last session but the
// next session has no record of it" happens.
//
// This fires when the main agent finishes a turn. It does NOT block (a hard block
// on every stop would force a push mid-conversation, before the agent can even
// answer). Instead it surfaces a loud, deduped reminder whenever the unpushed/
// uncommitted state CHANGES, so the state is impossible to miss over a session.
// Hard push-enforcement lives where it belongs: /handoff-session + /remember
// verify their pushes, and CLAUDE.md makes "commit+push completed work before
// ending" binding.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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

  const problems = [];
  if (ahead > 0) problems.push(`${ahead} commit(s) on '${branch}' are NOT pushed`);
  if (!hasUpstream && localCommits > 0)
    problems.push(`'${branch}' has no upstream — nothing on this branch is pushed`);
  if (dirty)
    problems.push(`${dirty.split("\n").length} uncommitted change(s) in the working tree`);

  if (problems.length === 0) process.exit(0); // clean — say nothing

  // Dedupe: only re-warn when the state signature changes, so a long session
  // isn't spammed every turn.
  const sig = `${branch}|${ahead}|${hasUpstream ? 1 : 0}|${dirty ? dirty.split("\n").length : 0}`;
  const stateFile = `/tmp/session-guard-${input.session_id ?? "s"}`;
  const last = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : "";
  if (last === sig) process.exit(0);
  writeFileSync(stateFile, sig);

  const fix = `git add -A && git commit -m "<msg>" && git push -u origin ${branch}`;
  console.error(
    `[session-guard] Work is only safe once PUSHED — a fresh container clones nothing else (#14):\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      `\n  Commit + push completed work (or run /handoff-session) before this session ends:\n    ${fix}`
  );
} catch {
  /* a hook must never trap the agent */
}
process.exit(0);
