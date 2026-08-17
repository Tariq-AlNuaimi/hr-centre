#!/usr/bin/env node
// PreToolUse hook (Edit|Write|MultiEdit) -- path-lazy rule loading (harness-v2 V2-101).
//
// The constitution (CLAUDE.md) is the always-on floor; domain detail lives in
// `docs/rules/*.md`, each carrying a frontmatter `globs:` header. When the agent edits a
// file whose path matches a rule file's globs, this hook injects that rule file's body as
// `additionalContext` so the relevant rules are present WITHOUT taxing every session's
// SessionStart context. Mirrors `skill-activation.mjs` (same glob/relPath logic, same advisory
// `additionalContext`-only contract): NEVER blocks, never returns a permissionDecision, and stays
// silent on any internal error (fail-open -- a suggester must never brick a turn).
//
// Data-driven: the rule files ARE the source of truth (add a file with a `globs:` header and it
// participates, no code change). Dedupes within a single fire.
//
// WHY `docs/rules/` AND NOT `.claude/rules/` (B1, 2026-08-17): Claude Code auto-discovers
// markdown under `.claude/` as project-instruction files and loads it into EVERY session. The
// six rule files therefore cost ~32.8KB (~8.2K tokens) of ALWAYS-ON context — exactly the tax
// this path-lazy hook exists to avoid, so the design was defeated by its own location. Moving
// them under `docs/` (not auto-discovered) makes the laziness real. Do NOT move them back.
// `scripts/context-tax.mjs` fails --strict if a `.claude/rules/*.md` file reappears.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const RULES_REL = "docs/rules";
const RULES_DIR = join(ROOT, "docs", "rules");

/** Minimal glob -> RegExp (supports **, *, literal segments) -- identical to skill-activation. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
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
  const root = ROOT.replace(/\\/g, "/");
  if (s.startsWith(root)) s = s.slice(root.length);
  return s.replace(/^\.?\//, "");
}

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

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!input.tool_name || !/^(Edit|Write|MultiEdit)$/.test(input.tool_name)) process.exit(0);
  const file = relPath(input.tool_input?.file_path);
  if (!file) process.exit(0);

  let entries;
  try {
    entries = readdirSync(RULES_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    process.exit(0); // no rules dir -> nothing to inject
  }

  const matched = []; // { name, title, body }
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

  if (matched.length === 0) process.exit(0);

  const blocks = matched
    .map((r) => `--- ${RULES_REL}/${r.name}${r.title ? ` — ${r.title}` : ""} ---\n${r.body}`)
    .join("\n\n");
  const context =
    `[rules-injection] Editing \`${file}\` — the following path-scoped rule file(s) apply ` +
    `(loaded lazily, they are NOT in the always-on constitution). Follow them:\n\n${blocks}`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context },
    }),
  );
} catch {
  /* fail-open: a rule surfacer must never brick a turn */
}
process.exit(0);
