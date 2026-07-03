#!/usr/bin/env node
// UserPromptSubmit + PreToolUse hook -- rule-based skill auto-activation (Wave
// A4 / cat 01; pattern: ChrisWiles/claude-code-showcase, docs/deep-comparison/
// 01-collections.md). Consumes the advisory map in .claude/skill-rules.json and
// SUGGESTS the mapped skill so the agent uses it instead of improvising.
//
// Operator-confirmed defaults (2026-07-03):
//   - Events: UserPromptSubmit (prompt text -> `keywords`) AND PreToolUse on
//     Edit|Write|MultiEdit (touched file -> `paths` globs).
//   - Advisory / warn-only: emits `additionalContext` only; NEVER blocks and
//     never returns a permissionDecision, so it cannot override CLAUDE.md, the
//     Ask-before list, or a skill's own Skip-when carve-outs.
//   - Fires on EVERY matching prompt/edit (no session dedupe).
//   - Suggests ALL matched skills (deduped within a single fire), not just one.
//
// This hook is data-driven: skill-rules.json is the source of truth; editing the
// map changes behaviour with no code change. On any internal error it stays
// silent (a suggester must never brick a turn).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

/** Minimal glob -> RegExp for the `paths` entries (supports **, *, literal segments). */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** -> any depth. `**/` spans zero-or-more leading dirs; a trailing
        // `**` (e.g. `lib/**`) matches everything below, files included.
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*"; // * -> within one segment
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Normalise a file path to repo-relative, forward-slashed. */
function relPath(p) {
  if (!p) return "";
  let s = String(p).replace(/\\/g, "/");
  if (s.startsWith(ROOT.replace(/\\/g, "/"))) s = s.slice(ROOT.length);
  return s.replace(/^\.?\//, "");
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));

  let rules;
  try {
    rules = JSON.parse(readFileSync(join(ROOT, ".claude/skill-rules.json"), "utf8")).rules;
  } catch {
    process.exit(0); // no map -> nothing to suggest
  }
  if (!Array.isArray(rules)) process.exit(0);

  const matched = new Map(); // skill -> reason (dedupe within this fire)

  if (typeof input.prompt === "string") {
    // UserPromptSubmit: intent match against keywords.
    const hay = input.prompt.toLowerCase();
    for (const r of rules) {
      if (matched.has(r.skill)) continue;
      if ((r.keywords || []).some((k) => hay.includes(String(k).toLowerCase()))) {
        matched.set(r.skill, r.reason);
      }
    }
  } else if (input.tool_name) {
    // PreToolUse: only edits carry a file path worth path-matching.
    if (!/^(Edit|Write|MultiEdit)$/.test(input.tool_name)) process.exit(0);
    const file = relPath(input.tool_input?.file_path);
    if (!file) process.exit(0);
    for (const r of rules) {
      if (matched.has(r.skill)) continue;
      if ((r.paths || []).some((g) => globToRegExp(g).test(file))) {
        matched.set(r.skill, r.reason);
      }
    }
  } else {
    process.exit(0);
  }

  if (matched.size === 0) process.exit(0);

  const lines = [...matched].map(([skill, reason]) => `  - /${skill} — ${reason}`);
  const context =
    `[skill-activation] This work matches ${matched.size} skill rule` +
    `${matched.size > 1 ? "s" : ""} (advisory; skill-rules.json). Consider before improvising:\n` +
    lines.join("\n") +
    `\nInvoke via the Skill tool if it fits; this never overrides CLAUDE.md, the ` +
    `Ask-before list, or a skill's Skip-when.`;

  const eventName = typeof input.prompt === "string" ? "UserPromptSubmit" : "PreToolUse";
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  }));
} catch {
  /* a suggester must never brick a turn */
}
process.exit(0);
