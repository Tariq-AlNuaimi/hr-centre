#!/usr/bin/env node
// PreCompact hook -- context refresh (Wave A2).
// Compaction summarizes the transcript; the CLAUDE.md token-thrift rule says
// the modified-file list, last /ship status, open findings, and the operator's
// goal must ALWAYS survive it. This hook re-injects those essentials (plus the
// standing-instruction pointers) right before compaction so the post-compact
// context starts from facts, not a lossy summary. Replaces the previous static
// echo binding and keeps its persist-state reminder. Everything is best-effort
// and bounded; on any failure the static essentials still print (exit 0 always).
// Evidence: docs/deep-comparison/04-hooks.md webdevtodayjason row.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const CAP = 25; // max files listed per bucket
const ROOT = process.env.CLAUDE_PROJECT_DIR || ".";

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}
function capped(lines) {
  return lines.length > CAP ? [...lines.slice(0, CAP), `  ... +${lines.length - CAP} more`] : lines;
}

const out = [];
out.push(
  "[pre-compact] Binding essentials to PRESERVE through compaction (CLAUDE.md token-thrift rule):",
);

try {
  try {
    readFileSync(0, "utf8");
  } catch {} // drain stdin; payload not needed

  // 1. Standing pointers (always)
  out.push(
    "- Re-read after compaction if unsure: CLAUDE.md (standing instructions + hard rules), docs/agent-memory.md.",
    "- Persist in-flight state BEFORE relying on the summary: /handoff-session, and commit+push (#3/#14).",
  );

  // 2. Modified-file list (git, cheap)
  if (git("rev-parse --is-inside-work-tree") === "true") {
    const branch = git("rev-parse --abbrev-ref HEAD") || "?";
    const dirty = git("status --porcelain").split("\n").filter(Boolean);
    const hasUpstream = !!git("rev-parse --abbrev-ref --symbolic-full-name @{u}");
    const unpushed = hasUpstream
      ? git("diff --name-only @{u}..HEAD").split("\n").filter(Boolean)
      : [];
    const ahead = hasUpstream ? git("rev-list --count @{u}..HEAD") || "0" : "?";
    out.push(
      `- Branch: ${branch} (${hasUpstream ? `${ahead} unpushed commit(s)` : "NO upstream — nothing pushed"}).`,
    );
    if (dirty.length) out.push("- Uncommitted changes:", ...capped(dirty.map((l) => `    ${l}`)));
    if (unpushed.length)
      out.push("- In unpushed commits:", ...capped(unpushed.map((f) => `    ${f}`)));
    if (!dirty.length && !unpushed.length) out.push("- Working tree clean and pushed.");
  }

  // 3. Last /ship status (only if recorded in the session handoff)
  let ship = "not recorded (re-run npm run ship before trusting green)";
  if (existsSync(`${ROOT}/docs/SESSION-HANDOFF.md`)) {
    const h = readFileSync(`${ROOT}/docs/SESSION-HANDOFF.md`, "utf8");
    const m = h.match(/last\s+\/ship[:\s]*([^\n]*)/i);
    if (m && m[1].trim()) ship = m[1].trim();
    // 4. Operator goal (## Goal section, first lines)
    const g = h.match(/^## Goal\s*\n([\s\S]*?)(?=\n## |\n*$)/m);
    if (g) {
      const goal = g[1].trim().split("\n").slice(0, 6).join("\n    ");
      if (goal) out.push(`- Operator goal (docs/SESSION-HANDOFF.md):\n    ${goal}`);
    }
  }
  out.push(`- Last /ship: ${ship}`);

  // 5. Open findings (wave-offs block /ship)
  if (existsSync(`${ROOT}/docs/findings-register.md`)) {
    const open = readFileSync(`${ROOT}/docs/findings-register.md`, "utf8")
      .split("\n")
      .filter((l) => /^-\s*\d{4}-\d{2}-\d{2}\b.*\bstatus:\s*open\b(?!\s*\|)/i.test(l));
    out.push(
      open.length
        ? `- Open findings-register wave-offs (BLOCK /ship): ${open.length}` +
            open
              .slice(0, 3)
              .map((l) => `\n    ${l.slice(0, 120)}`)
              .join("")
        : "- Findings register: no open wave-offs.",
    );
  }
} catch {
  /* still print what we have; never fail compaction */
}

console.log(out.join("\n"));
process.exit(0);
