#!/usr/bin/env node
// scripts/rebrand.mjs
//
// Sweep the template's hardcoded defaults and replace them with the fork's
// project identity. Idempotent. See .claude/skills/rebrand/SKILL.md.
//
// Usage:
//   npm run rebrand -- --slug acme-portal --name "Acme Portal" --owner acme-corp
//                      [--owner-name "Jane Doe"] [--dry-run]

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { parseArgs } from "node:util";

const ROOT = process.cwd();

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    owner: { type: "string" },
    "owner-name": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "prune-docs": { type: "boolean", default: false },
  },
  strict: true,
});

// --- Fork doc-payload prune list (V2-506) --------------------------------------------
// A standalone mode: classify every doc via docs/doc-manifest.json (first-match-wins glob
// rules) into fork-inherited vs template-dev-history, and print the prune list. NON-
// destructive — it only LISTS; the actual prune on a fork MOVES the template-dev docs to an
// archive branch reference, never deletes them from template main. Runs without --slug etc.
if (values["prune-docs"]) {
  await pruneDocsMode();
  process.exit(0);
}

/** Glob → RegExp. Supports `**` (any path incl. `/`), `*` (any run except `/`), literal `.`. */
function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (".+?^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(re + "$");
}

async function pruneDocsMode() {
  const manifestPath = join(ROOT, "docs", "doc-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (e) {
    console.error(
      `ERROR: cannot read docs/doc-manifest.json (${e?.message ?? e}). V2-506 classification is required for --prune-docs.`,
    );
    process.exit(1);
  }
  const rules = (manifest.rules ?? []).map((r) => ({ ...r, re: globToRegExp(r.glob) }));

  // Collect every doc: all of docs/** plus the root-level HARNESS-V2-*.md program files.
  const files = [];
  async function walk(dir) {
    for (const ent of await readdir(join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(rel);
      else files.push(rel);
    }
  }
  await walk("docs");
  for (const ent of await readdir(ROOT, { withFileTypes: true })) {
    if (ent.isFile() && /^HARNESS-V2-.*\.md$/.test(ent.name)) files.push(ent.name);
  }
  files.sort();

  const prune = [];
  const keep = [];
  const unmatched = [];
  for (const f of files) {
    const norm = f.split(sep).join("/");
    const hit = rules.find((r) => r.re.test(norm));
    if (!hit) unmatched.push(norm);
    else if (hit.inheritance === "template-dev") prune.push(norm);
    else keep.push(norm);
  }

  console.log("--- Fork doc-payload prune list (V2-506, dry) ---");
  console.log(
    `Classified ${files.length} docs: ${keep.length} fork-inherited (kept), ${prune.length} template-dev (prune).`,
  );
  console.log("");
  console.log(`Template-dev docs a fork does not inherit (the template's own build history):`);
  for (const p of prune) console.log(`  prune  ${p}`);
  if (unmatched.length) {
    console.log("");
    console.log(
      `WARNING: ${unmatched.length} doc(s) matched NO rule — defaulting to KEEP. Add a rule to docs/doc-manifest.json:`,
    );
    for (const u of unmatched) console.log(`  ??     ${u}`);
  }
  console.log("");
  console.log(
    "This is a LIST only. Archive the pruned set (a tag or branch ref) before removing it,",
  );
  console.log(
    "so it stays recoverable from git — the template itself did this at the tag\n" +
      "`template-history-2026-07` on 2026-07-25; see docs/ARCHIVE.md.",
  );
}

if (!values.slug || !values.name || !values.owner) {
  console.error("ERROR: --slug, --name, --owner are all required.");
  console.error(
    'Usage: npm run rebrand -- --slug acme-portal --name "Acme Portal" --owner acme-corp',
  );
  process.exit(1);
}

const SLUG = values.slug;
if (!/^[a-z][a-z0-9-]*$/.test(SLUG)) {
  console.error(
    `ERROR: --slug "${SLUG}" must be kebab-case (lowercase letters, digits, hyphens; starts with a letter).`,
  );
  process.exit(1);
}

const NAME = values.name;
const OWNER = values.owner;
const OWNER_NAME = values["owner-name"] ?? OWNER;
const DRY = values["dry-run"];

// NOTE: The Vercel + Neon pivot (ADR-006) deleted the Docker/GHCR/Portainer
// surface, so rebrand only touches the identity strings that still exist on the
// current rail: package name, the public app name, and the CLAUDE.md / README
// headers. docker-compose.yml + Makefile carry no template-specific identity.
const FILES = [
  {
    path: "package.json",
    rules: [{ from: /"name": "fullstack-next-template"/, to: `"name": "${SLUG}"` }],
  },
  {
    // Clear the pristine-template marker: a rebranded repo is a fork, so it must
    // be gated by the ADR-031 db-structure check (scripts/ship.mjs). No-op if the
    // flag is already false/absent (absence already means "gated"). See ADR-031.
    path: "project.config.json",
    rules: [{ from: /"pristine":\s*true/, to: '"pristine": false' }],
  },
  {
    path: ".env.example",
    rules: [{ from: /NEXT_PUBLIC_APP_NAME="My App"/g, to: `NEXT_PUBLIC_APP_NAME="${NAME}"` }],
  },
  {
    path: "CLAUDE.md",
    rules: [
      {
        from: /^# CLAUDE\.md — Fullstack Next\.js Template \(Prototype Rail\)$/m,
        to: `# CLAUDE.md — ${NAME}`,
      },
      {
        // Current tagline line (single line; matches up to the trailing owner sentence).
        from: /^Reusable starter for Rihal internal-tool prototypes\..*Owner: .+\.$/m,
        to: `${NAME} — forked from fullstack-vibe-template. Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + Ant Design + next-intl. Deploys to Vercel + Neon via \`git push\`. Owner: ${OWNER_NAME}.`,
      },
    ],
  },
  {
    path: "README.md",
    rules: [
      {
        from: /^# Fullstack Next\.js Template \(Prototype Rail\)$/m,
        to: `# ${NAME}`,
      },
    ],
  },
];

const diffs = [];

for (const file of FILES) {
  const path = join(ROOT, file.path);
  let src;
  try {
    src = await readFile(path, "utf8");
  } catch (e) {
    console.warn(`SKIP ${file.path}: ${e && e.message ? e.message : String(e)}`);
    continue;
  }

  let out = src;
  let changed = 0;
  for (const rule of file.rules) {
    const before = out;
    out = out.replace(rule.from, rule.to);
    if (out !== before) changed += 1;
  }

  if (out !== src) {
    diffs.push({ path, before: src, after: out, changedRules: changed });
  }
}

if (diffs.length === 0) {
  console.log(
    "No changes -- template is already rebranded to these values, or no matching strings were found.",
  );
  process.exit(0);
}

if (DRY) {
  console.log("--- DRY RUN ---");
  for (const d of diffs) {
    console.log(
      `${d.path}: would apply ${d.changedRules} rule(s), delta = ${d.after.length - d.before.length} bytes`,
    );
  }
  console.log("");
  console.log("Re-run without --dry-run to write.");
  process.exit(0);
}

for (const d of diffs) {
  await writeFile(d.path, d.after);
  console.log(`~ ${d.path} (${d.changedRules} rule(s))`);
}

console.log("");
console.log("Rebrand complete. Next:");
console.log(`  git add -A && git commit -m "chore: rebrand to ${SLUG}"`);
console.log("  /first-fork    # finish the bootstrap (Vercel + Neon, env vars, first deploy)");
