#!/usr/bin/env node
// Agent-memory digest tool (harness-v2 V2-102).
//
// docs/agent-memory.md is surfaced retrieval-on-demand: only the <!-- BEGIN/END:digest --> block
// (section headers + one-liners) is printed at SessionStart; full `##` sections are grep/read on
// demand. This tool:
//   • validates the mechanical budget — digest ≤ 30 lines, each `##` section ≤ 60 lines;
//   • `--write` refreshes each digest line's `(N)` entry-count from the live sections and flags
//     any section missing a digest line (summaries stay human-curated — a memory digest can't be
//     auto-summarized without an LLM; the count + coverage are what drift, so those are mechanical).
//
// Usage: `node scripts/memory-digest.mjs [--write] [--strict]` (npm run memory-digest).
// Advisory by default (exit 0). `--strict` exits 1 on any budget breach (used by the hook test).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const FILE = process.env.MEMORY_FILE || join(ROOT, "docs", "agent-memory.md");
const DIGEST_BUDGET = 30;
const SECTION_BUDGET = 60;
const EXCLUDE = new Set(["Digest", "How to use it"]); // meta sections, not content

const write = process.argv.includes("--write");
const strict = process.argv.includes("--strict");

let text;
try {
  text = readFileSync(FILE, "utf8");
} catch {
  console.error(`[memory-digest] cannot read ${FILE}`);
  process.exit(strict ? 1 : 0);
}

const DIGEST_RE = /(<!-- BEGIN:digest[^>]*-->)([\s\S]*?)(<!-- END:digest[^>]*-->)/;
const dm = DIGEST_RE.exec(text);

// Parse `##` sections from the WHOLE file: {name, headingLine, lines[]}.
const lines = text.split("\n");
const sections = [];
let cur = null;
for (const line of lines) {
  const h = /^##\s+(.+?)\s*$/.exec(line);
  if (h) {
    cur = { name: h[1].replace(/\s*\(.*$/, "").trim(), rawName: h[1].trim(), body: [] };
    sections.push(cur);
  } else if (cur) {
    cur.body.push(line);
  }
}

// Content sections = everything except the meta ones (match on the leading words).
const content = sections.filter((s) => ![...EXCLUDE].some((e) => s.rawName.startsWith(e)));
const entryCount = (s) => s.body.filter((l) => /^- /.test(l)).length;
const sectionLines = (s) => s.body.length + 1; // + the heading line

// Budget report.
const problems = [];
let digestLineCount = 0;
if (dm) {
  digestLineCount = dm[2]
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("<!--")).length;
  if (digestLineCount > DIGEST_BUDGET)
    problems.push(`digest is ${digestLineCount} lines (budget ${DIGEST_BUDGET})`);
} else {
  problems.push("no <!-- BEGIN/END:digest --> block found");
}
for (const s of content) {
  const n = sectionLines(s);
  if (n > SECTION_BUDGET)
    problems.push(`section "${s.rawName}" is ${n} lines (budget ${SECTION_BUDGET})`);
}

// A section "has a digest line" if `- **<bold>**` appears where the section heading starts with
// <bold> (digest bold may be a terse prefix, e.g. "Conventions" → "Conventions discovered").
const boldOf = (s) => {
  const boldTexts = (dm ? dm[2].match(/- \*\*(.+?)\*\*/g) || [] : []).map((m) =>
    m.replace(/^- \*\*|\*\*$/g, ""),
  );
  return boldTexts.find((b) => s.rawName.startsWith(b) || s.name === b) || null;
};

// --write: refresh NUMERIC `(N)` counts in digest lines; leave non-numeric tags (e.g. "(binding)")
// alone; flag sections with no digest line at all.
if (write && dm) {
  let block = dm[2];
  const missing = [];
  for (const s of content) {
    const bold = boldOf(s);
    if (!bold) {
      missing.push(s.rawName);
      continue;
    }
    const boldEsc = bold.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    block = block.replace(
      new RegExp(`(- \\*\\*${boldEsc}\\*\\*\\s*)\\(\\d+\\)`),
      `$1(${entryCount(s)})`,
    );
  }
  if (missing.length) problems.push(`sections missing a digest line: ${missing.join(", ")}`);
  const next = text.replace(DIGEST_RE, `$1${block}$3`);
  if (next !== text) {
    writeFileSync(FILE, next);
    console.log("[memory-digest] refreshed digest entry-counts");
  }
} else if (dm) {
  // check-only: still flag missing digest lines.
  const missing = content.filter((s) => !boldOf(s)).map((s) => s.rawName);
  if (missing.length) problems.push(`sections missing a digest line: ${missing.join(", ")}`);
}

console.log(
  `[memory-digest] digest ${digestLineCount}/${DIGEST_BUDGET} lines · ${content.length} content sections · ` +
    content.map((s) => `${s.name}:${sectionLines(s)}L`).join(" · "),
);
if (problems.length) {
  console.log("[memory-digest] BUDGET WARNINGS:");
  for (const p of problems) console.log(`  - ${p}`);
  if (strict) process.exit(1);
} else {
  console.log("[memory-digest] all budgets OK.");
}
process.exit(0);
