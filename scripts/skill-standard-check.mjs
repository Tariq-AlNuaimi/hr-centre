#!/usr/bin/env node
// scripts/skill-standard-check.mjs (V2-503)
//
// Validate every .claude/skills/*/SKILL.md frontmatter against the agentskills.io open
// standard (https://agentskills.io/specification — the format Anthropic released and the
// ecosystem adopted). This is the dependency-free node equivalent of `skills-ref validate`
// (agentskills/agentskills), wired so conformance can't silently drift as skills are added.
//
// Rules enforced (per the spec):
//   name         REQUIRED. 1–64 chars; lowercase a-z0-9 + hyphens; no leading/trailing hyphen;
//                no consecutive hyphens; MUST equal the parent directory name.
//   description  REQUIRED. 1–1024 chars, non-empty.
//   optional     only these keys are allowed beyond name/description:
//                license, compatibility (≤500), metadata (map), allowed-tools.
//   any other top-level frontmatter key is drift (flagged).
//
// Exit 0 = all conformant; exit 1 = drift (each problem printed as `<skill>: <field> — <why>`).
// Run: `npm run skill-check`.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(process.cwd(), ".claude", "skills");
const ALLOWED_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // lowercase alnum, single hyphens, no lead/trail/double

/** Extract the YAML frontmatter block (between the first pair of `---` fences). */
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/** Top-level frontmatter keys (a top-level key is a non-indented `key:` line). */
function topLevelKeys(fm) {
  return [...fm.matchAll(/^([A-Za-z][\w-]*):/gm)].map((m) => m[1]);
}

/** A single top-level scalar field's value (name/description/compatibility), trimmed. */
function scalar(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*([\\s\\S]*?)(?=\\n[A-Za-z][\\w-]*:|$)`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function checkSkill(dirName) {
  const problems = [];
  const file = join(SKILLS_DIR, dirName, "SKILL.md");
  if (!existsSync(file)) return [`${dirName}: SKILL.md — missing`];
  const src = readFileSync(file, "utf8");
  const fm = frontmatter(src);
  if (!fm) return [`${dirName}: frontmatter — missing or malformed (no --- fenced block)`];

  const name = scalar(fm, "name");
  if (!name) problems.push(`${dirName}: name — required, missing`);
  else {
    if (name.length > 64) problems.push(`${dirName}: name — >64 chars (${name.length})`);
    if (!NAME_RE.test(name))
      problems.push(
        `${dirName}: name — "${name}" must be lowercase a-z0-9 + single hyphens, no lead/trail/double hyphen`,
      );
    if (name !== dirName)
      problems.push(
        `${dirName}: name — "${name}" must equal the parent directory name "${dirName}"`,
      );
  }

  const description = scalar(fm, "description");
  if (!description) problems.push(`${dirName}: description — required, non-empty`);
  else if (description.length > 1024)
    problems.push(`${dirName}: description — >1024 chars (${description.length})`);

  const compatibility = scalar(fm, "compatibility");
  if (compatibility && compatibility.length > 500)
    problems.push(`${dirName}: compatibility — >500 chars (${compatibility.length})`);

  for (const k of topLevelKeys(fm))
    if (!ALLOWED_KEYS.has(k))
      problems.push(
        `${dirName}: ${k} — not an Agent Skills frontmatter field (allowed: ${[...ALLOWED_KEYS].join(", ")})`,
      );

  return problems;
}

function main() {
  if (!existsSync(SKILLS_DIR)) {
    console.error(`skill-check: no ${SKILLS_DIR} directory — nothing to validate.`);
    process.exit(0);
  }
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const problems = dirs.flatMap(checkSkill);
  if (problems.length === 0) {
    console.log(`skill-check: all ${dirs.length} skills conform to the agentskills.io standard.`);
    process.exit(0);
  }
  console.error(
    `skill-check: ${problems.length} conformance problem(s) across ${dirs.length} skills:\n`,
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nFix the frontmatter (https://agentskills.io/specification) and re-run \`npm run skill-check\`.`,
  );
  process.exit(1);
}

main();
