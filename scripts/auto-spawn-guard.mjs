#!/usr/bin/env node
// auto-spawn-guard.mjs -- Part 3 of session-automation (blueprint:
// docs/blueprints/session-automation-auto-handoff.md).
//
// Evaluates the MANDATORY guardrails before a session is allowed to schedule a
// successor session (true auto-spawn). This is the safety kernel; it does NOT
// itself call the Claude Code Remote MCP `create_trigger`, because hooks/scripts
// cannot invoke MCP tools. The boundary is deliberate:
//
//   guard (this script)  ->  decides IF a spawn is permitted (pure, testable)
//   agent (has the MCP)  ->  actually fires create_trigger when the guard says yes
//
// The SessionEnd auto-handoff hook runs this guard; when it returns PERMITTED it
// writes a spawn-request signal and prints the exact create_trigger parameters,
// so the operator (or a trusted closeout step) fires it. Default state ships
// DISABLED (`autoSpawn.enabled=false`) -- nothing is ever scheduled until the
// operator opts in, so this cannot run away or burn tokens unattended.
//
// Guardrails (all must hold):
//   1. autoSpawn.enabled === true        (opt-in per program; default false)
//   2. branch has an upstream AND @{u}..HEAD == 0   (pushed -> successor sees it)
//   3. .claude/state/last-green-sha exists AND equals the current short HEAD
//        (the gitignored signal /ship writes for the exact tree it verified green;
//        a stray post-ship commit moves HEAD past it -> BLOCK. Fails CLOSED: a
//        missing/empty/mismatched signal is a block, never a silent pass.)
//   4. autoSpawn.consecutiveCount < autoSpawn.cap
//        (stop after N spawns with no human turn; reset by --reset on a human start)
//
// Modes:
//   node scripts/auto-spawn-guard.mjs            evaluate; print JSON verdict.
//                                                exit 0 = PERMITTED, 3 = BLOCKED.
//   node scripts/auto-spawn-guard.mjs --record   post-fire: consecutiveCount++,
//                                                stamp lastSpawnSha. exit 0.
//   node scripts/auto-spawn-guard.mjs --reset    human turn: consecutiveCount=0. exit 0.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR
  ? process.env.CLAUDE_PROJECT_DIR
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "docs", "session-state.json");
const GREEN_SHA_FILE = join(ROOT, ".claude", "state", "last-green-sha");

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function loadState() {
  if (!existsSync(STATE)) throw new Error(`missing ${STATE}`);
  return JSON.parse(readFileSync(STATE, "utf8"));
}
function saveState(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");
}

const arg = process.argv[2];

// --- mutation modes (never evaluate) ---------------------------------------
if (arg === "--record" || arg === "--reset") {
  try {
    const s = loadState();
    s.autoSpawn = s.autoSpawn || { enabled: false, cap: 3, consecutiveCount: 0, lastSpawnSha: null };
    if (arg === "--record") {
      s.autoSpawn.consecutiveCount = (s.autoSpawn.consecutiveCount || 0) + 1;
      s.autoSpawn.lastSpawnSha = git("rev-parse --short HEAD") || s.autoSpawn.lastSpawnSha;
    } else {
      s.autoSpawn.consecutiveCount = 0;
    }
    saveState(s);
    process.stderr.write(`[auto-spawn-guard] ${arg} -> consecutiveCount=${s.autoSpawn.consecutiveCount}\n`);
  } catch (e) {
    process.stderr.write(`[auto-spawn-guard] ${arg} failed: ${e.message}\n`);
  }
  process.exit(0);
}

// --- evaluate ---------------------------------------------------------------
let verdict = { permitted: false, reasons: [] };
try {
  const s = loadState();
  const a = s.autoSpawn || {};
  const reasons = [];

  if (a.enabled !== true) reasons.push("autoSpawn.enabled is false (opt-in — the operator has not turned auto-spawn on)");

  const upstream = git("rev-parse --abbrev-ref --symbolic-full-name @{u}");
  if (!upstream) reasons.push("branch has no upstream — nothing is pushed");
  else {
    const ahead = Number(git("rev-list --count @{u}..HEAD") || "0");
    if (ahead > 0) reasons.push(`${ahead} commit(s) unpushed — a successor would not see them`);
  }
  // A dirty working tree means uncommitted work a fresh container (or spawned session)
  // would never see. "Pushed" is not enough — the tree must also be clean.
  if (git("status --porcelain") !== "") reasons.push("uncommitted changes in the working tree — commit + push before spawning (a successor clones only pushed state)");

  const headShort = git("rev-parse --short HEAD");
  // Fail CLOSED on the green-for-HEAD signal: read the gitignored file /ship writes.
  let greenSha = "";
  try {
    if (existsSync(GREEN_SHA_FILE)) greenSha = readFileSync(GREEN_SHA_FILE, "utf8").trim();
  } catch { /* treated as missing -> block */ }
  if (!greenSha) reasons.push("no green-ship signal for this session (.claude/state/last-green-sha absent) — run /ship at HEAD before spawning");
  else if (!headShort) reasons.push("cannot resolve current HEAD");
  else if (greenSha !== headShort) reasons.push(`green ship (${greenSha}) is not for current HEAD (${headShort}) — a commit moved past the last /ship; re-ship before spawning`);

  const cap = Number.isInteger(a.cap) ? a.cap : 3;
  const count = a.consecutiveCount || 0;
  if (count >= cap) reasons.push(`consecutive auto-spawn cap reached (${count}/${cap}) — a human turn must reset it`);

  verdict = {
    permitted: reasons.length === 0,
    reasons,
    branch: git("rev-parse --abbrev-ref HEAD"),
    head: headShort,
    consecutiveCount: count,
    cap,
  };
} catch (e) {
  verdict = { permitted: false, reasons: [`guard error: ${e.message}`] };
}

process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
process.exit(verdict.permitted ? 0 : 3);
