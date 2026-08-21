#!/usr/bin/env node
// UserPromptSubmit + PreToolUse advisory context hook.
//
// MERGED 2026-08-17 (B3) from skill-activation.mjs + rules-injection.mjs. They
// were two separate hooks on the same PreToolUse(Edit|Write|MultiEdit) matcher,
// with the same advisory contract, duplicating the same glob/relPath helpers --
// so every edit paid two process spawns to produce two blocks of guidance that
// arrive together anyway. Now one spawn, one combined block, and the shared
// helpers live in lib/path-match.mjs.
//
// Two suggestion sources, unchanged in behaviour:
//   1. SKILLS  -- .claude/skill-rules.json maps `keywords` (prompt text) and
//      `paths` (edited file) to a skill, so the agent uses it instead of
//      improvising.
//   2. RULES   -- docs/rules/*.md carry a frontmatter `globs:` header; a match
//      injects that rule's body, which is how the path-scoped rules stay OUT of
//      the always-on constitution and load lazily instead.
//
// CONTRACT (both sources): advisory only. Emits `additionalContext` and NEVER a
// permissionDecision, so it cannot override CLAUDE.md, the Ask-before list, or a
// skill's Skip-when. Silent on ANY internal error -- a suggester must never
// brick a turn. Data-driven: editing skill-rules.json or a rule file's globs
// changes behaviour with no code change.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { globToRegExp, relPath } from "./lib/path-match.mjs";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const RULES_REL = "docs/rules";
const RULES_DIR = join(ROOT, "docs", "rules");

/** Parse a rule file's frontmatter: returns { globs: string[], title, body }. */
function parseRule(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { globs: [], title: "", body: text };
  const front = m[1];
  const body = m[2];
  const globsLine = /^globs:\s*(.+)$/m.exec(front);
  const titleLine = /^title:\s*(.+)$/m.exec(front);
  const globs = globsLine
    ? globsLine[1]
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : [];
  return { globs, title: titleLine ? titleLine[1].trim() : "", body: body.trim() };
}

/** Matched skill suggestions -> a text block (or null). */
function skillBlock(input, file) {
  let rules;
  try {
    rules = JSON.parse(readFileSync(join(ROOT, ".claude/skill-rules.json"), "utf8")).rules;
  } catch {
    return null; // no map -> nothing to suggest
  }
  if (!Array.isArray(rules)) return null;

  const matched = new Map(); // skill -> reason (dedupe within this fire)
  if (typeof input.prompt === "string") {
    const hay = input.prompt.toLowerCase();
    for (const r of rules) {
      if (matched.has(r.skill)) continue;
      if ((r.keywords || []).some((k) => hay.includes(String(k).toLowerCase()))) {
        matched.set(r.skill, r.reason);
      }
    }
  } else if (file) {
    for (const r of rules) {
      if (matched.has(r.skill)) continue;
      if ((r.paths || []).some((g) => globToRegExp(g).test(file))) {
        matched.set(r.skill, r.reason);
      }
    }
  }
  if (matched.size === 0) return null;

  const lines = [...matched].map(([skill, reason]) => `  - /${skill} — ${reason}`);
  return (
    `[skill-activation] This work matches ${matched.size} skill rule` +
    `${matched.size > 1 ? "s" : ""} (advisory; skill-rules.json). Consider before improvising:\n` +
    lines.join("\n") +
    `\nInvoke via the Skill tool if it fits; this never overrides CLAUDE.md, the ` +
    `Ask-before list, or a skill's Skip-when.`
  );
}

/** Matched path-scoped rule files -> a text block (or null). */
function ruleBlock(file) {
  if (!file) return null;
  let entries;
  try {
    entries = readdirSync(RULES_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return null; // no rules dir -> nothing to inject
  }

  const matched = [];
  for (const name of entries) {
    let parsed;
    try {
      parsed = parseRule(readFileSync(join(RULES_DIR, name), "utf8"));
    } catch {
      continue;
    }
    if (parsed.globs.some((g) => globToRegExp(g).test(file))) {
      matched.push({ name, title: parsed.title, body: parsed.body });
    }
  }
  if (matched.length === 0) return null;

  const blocks = matched
    .map((r) => `--- ${RULES_REL}/${r.name}${r.title ? ` — ${r.title}` : ""} ---\n${r.body}`)
    .join("\n\n");
  return (
    `[rules-injection] Editing \`${file}\` — the following path-scoped rule file(s) apply ` +
    `(loaded lazily, they are NOT in the always-on constitution). Follow them:\n\n${blocks}`
  );
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));

  const isPrompt = typeof input.prompt === "string";
  const isEdit = !!input.tool_name && /^(Edit|Write|MultiEdit)$/.test(input.tool_name);
  if (!isPrompt && !isEdit) process.exit(0);

  const file = isEdit ? relPath(input.tool_input?.file_path, ROOT) : "";
  if (isEdit && !file) process.exit(0);

  // Rules apply to edits only; skills to both. Order is deliberate: the binding
  // rules come first, the advisory skill nudge after.
  const parts = [isEdit ? ruleBlock(file) : null, skillBlock(input, file)].filter(Boolean);
  if (parts.length === 0) process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: isPrompt ? "UserPromptSubmit" : "PreToolUse",
        additionalContext: parts.join("\n\n"),
      },
    }),
  );
} catch {
  /* a suggester must never brick a turn */
}
process.exit(0);
