#!/usr/bin/env node
// scripts/install-senior-review.mjs
//
// Install the mandatory senior-code-reviewer into ANY repo -- including
// different-stack repos that can't receive a Next.js template sync. The three
// installed artifacts are stack-agnostic (a Claude agent definition, a CI
// workflow that diffs + reviews, and an AGENTS.md mandate), so this works the
// same in a Go, Python, Rails, or Next.js project.
//
// Usage (run from a checkout of this template):
//   node scripts/install-senior-review.mjs --target /path/to/other/repo
//   node scripts/install-senior-review.mjs            # installs into CWD
//
// Idempotent: re-running overwrites the agent + workflow with the current
// canonical versions and leaves the AGENTS.md mandate block in place (it is
// fenced by markers and only inserted once).

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = resolve(HERE, "..");

const { values } = parseArgs({
  options: { target: { type: "string" }, help: { type: "boolean" } },
});

if (values.help) {
  console.log("Usage: node scripts/install-senior-review.mjs [--target <repo path>]");
  process.exit(0);
}

const target = resolve(values.target ?? process.cwd());

const BEGIN = "<!-- BEGIN senior-code-review (managed) -->";
const END = "<!-- END senior-code-review (managed) -->";

const MANDATE = `${BEGIN}
## Mandatory: senior code review (post-push)

Every push of code MUST be followed by a senior-code-reviewer pass. It is the
**async, post-push breadth review** -- it catches cross-cutting invariant gaps,
threat-model holes, and operational drift that a fast diff review misses.

- **CI (preferred):** \`.github/workflows/senior-review.yml\` runs it on PRs and
  posts findings. Non-blocking -- it never delays your push. Activate by setting
  the \`ANTHROPIC_API_KEY\` secret and restoring the triggers in that file.
- **In-session fallback (when CI is off):** after pushing, invoke the
  \`senior-code-reviewer\` agent on the change before considering the work done.

This does NOT replace your pre-push checks (build/lint/test, and a fast diff
review). It layers on top: fast diff gate before push, breadth review after.
${END}`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyCanonical(relPath) {
  const src = join(TEMPLATE_ROOT, relPath);
  const dst = join(target, relPath);
  const body = await readFile(src, "utf8");
  await mkdir(dirname(dst), { recursive: true });
  await writeFile(dst, body);
  console.log(`  installed ${relPath}`);
}

async function upsertAgentsMandate() {
  const agentsPath = join(target, "AGENTS.md");
  const original = (await exists(agentsPath)) ? await readFile(agentsPath, "utf8") : "";
  let next;

  if (original.includes(BEGIN) && original.includes(END)) {
    // Replace the managed block in place (idempotent update).
    const before = original.slice(0, original.indexOf(BEGIN));
    const after = original.slice(original.indexOf(END) + END.length);
    next = `${before}${MANDATE}${after}`;
  } else {
    const sep = original && !original.endsWith("\n") ? "\n\n" : original ? "\n" : "";
    next = `${original}${sep}${MANDATE}\n`;
  }

  // Write ONLY when the content actually changes, so a re-run against an
  // already-current repo (e.g. the template itself) leaves the file — and the
  // git working tree — untouched instead of churning bytes.
  if (next === original) {
    console.log("  AGENTS.md mandate already current (no change)");
    return;
  }
  await writeFile(agentsPath, next);
  console.log(
    original.includes(BEGIN)
      ? "  updated AGENTS.md mandate block"
      : "  appended mandate to AGENTS.md",
  );
}

console.log(`Installing senior-code-reviewer into ${target}`);
if (target === TEMPLATE_ROOT) {
  // The template is where these artifacts are authored; installing "into itself"
  // must be a read-only no-op (never touch AGENTS.md or the working tree).
  console.log(
    "  (target is the template itself -- artifacts already live here; nothing to install)",
  );
} else {
  await copyCanonical(".claude/agents/senior-code-reviewer.md");
  await copyCanonical(".github/workflows/senior-review.yml");
  await upsertAgentsMandate();
}
console.log("\nDone. Next: set ANTHROPIC_API_KEY and restore triggers in");
console.log(".github/workflows/senior-review.yml to activate the CI gate (see");
console.log("the header of that file, and tools/senior-review/README.md).");
