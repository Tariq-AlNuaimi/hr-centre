#!/usr/bin/env node
// scripts/rebrand.mjs
//
// Sweep the template's hardcoded defaults and replace them with the fork's
// project identity. Idempotent. See .claude/skills/rebrand/SKILL.md.
//
// Usage:
//   npm run rebrand -- --slug acme-portal --name "Acme Portal" --owner acme-corp
//                      [--owner-name "Jane Doe"] [--dry-run]

import { readFile, writeFile, readdir, rm } from "node:fs/promises";
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
    // Actually DELETE the template-dev docs instead of only listing them. A normal
    // rebrand (a fork-creation path) implies this; `--no-prune` opts out.
    apply: { type: "boolean", default: false },
    "no-prune": { type: "boolean", default: false },
  },
  strict: true,
});

// --- Fork doc-payload prune list (V2-506) --------------------------------------------
// A standalone mode: classify every doc via docs/doc-manifest.json (first-match-wins glob
// rules) into fork-inherited vs template-dev-history, and print the prune list. NON-
// destructive — it only LISTS; the actual prune on a fork MOVES the template-dev docs to an
// archive branch reference, never deletes them from template main. Runs without --slug etc.
if (values["prune-docs"]) {
  await pruneDocsMode({ apply: values.apply, dryRun: values["dry-run"] });
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

async function pruneDocsMode({ apply = false, dryRun = false } = {}) {
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

  console.log(`--- Fork doc-payload prune (V2-506, ${apply && !dryRun ? "APPLY" : "dry"}) ---`);
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
  if (!apply || dryRun) {
    console.log(
      "This is a LIST only — re-run with --apply to delete. Archive the pruned set (a tag or",
    );
    console.log(
      "branch ref) before removing it, so it stays recoverable from git — the template itself\n" +
        "did this at the tag `template-history-2026-07` on 2026-07-25; see docs/ARCHIVE.md.",
    );
    return { prune, keep, deleted: 0 };
  }

  // APPLY. Safe by construction: a fork's template-dev docs are the TEMPLATE's build
  // history, already preserved in the template repo's own git history — deleting them
  // from the fork loses nothing that the fork ever owned. Deleting from the TEMPLATE
  // itself is the case that needs an archive ref first, which the dry-run text says.
  let deleted = 0;
  for (const p of prune) {
    try {
      await rm(join(ROOT, ...p.split("/")), { force: true });
      deleted++;
    } catch (e) {
      console.warn(`  WARN could not delete ${p}: ${e?.message ?? e}`);
    }
  }
  // Sweep directories the prune just emptied (capture sets leave husks behind).
  await removeEmptyDirs("docs");
  console.log(`Deleted ${deleted} template-dev doc(s). ${keep.length} fork-inherited doc(s) kept.`);
  console.log("Recoverable from the template repo's git history; see docs/ARCHIVE.md.");
  return { prune, keep, deleted };
}

/** Depth-first removal of directories left empty by the prune. Never touches files. */
async function removeEmptyDirs(rel) {
  let entries;
  try {
    entries = await readdir(join(ROOT, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) await removeEmptyDirs(`${rel}/${ent.name}`);
  }
  try {
    const left = await readdir(join(ROOT, rel));
    if (left.length === 0) await rm(join(ROOT, rel), { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
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

// A rebrand IS the fork-creation moment, so prune the template's own build history
// here rather than leaving it to a step nobody runs. Before this was wired (2026-07-25)
// the prune existed only as a list-only mode no fork path invoked, so every fork
// inherited the template-dev doc payload. `--no-prune` opts out.
if (!values["no-prune"]) {
  console.log("");
  await pruneDocsMode({ apply: true, dryRun: false });
}

console.log("");
console.log("Rebrand complete. Next:");
console.log(`  git add -A && git commit -m "chore: rebrand to ${SLUG}"`);
console.log("  /first-fork    # finish the bootstrap (Vercel + Neon, env vars, first deploy)");
