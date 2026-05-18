#!/usr/bin/env node
// scripts/rebrand.mjs
//
// Sweep the template's hardcoded defaults and replace them with the fork's
// project identity. Idempotent. See .claude/skills/rebrand/SKILL.md.
//
// Usage:
//   npm run rebrand -- --slug acme-portal --name "Acme Portal" --owner acme-corp
//                      [--owner-name "Jane Doe"] [--dry-run]

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = process.cwd();

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    owner: { type: 'string' },
    'owner-name': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.slug || !values.name || !values.owner) {
  console.error('ERROR: --slug, --name, --owner are all required.');
  console.error('Usage: npm run rebrand -- --slug acme-portal --name "Acme Portal" --owner acme-corp');
  process.exit(1);
}

const SLUG = values.slug;
if (!/^[a-z][a-z0-9-]*$/.test(SLUG)) {
  console.error(`ERROR: --slug "${SLUG}" must be kebab-case (lowercase letters, digits, hyphens; starts with a letter).`);
  process.exit(1);
}

const NAME = values.name;
const OWNER = values.owner;
const OWNER_NAME = values['owner-name'] ?? OWNER;
const DRY = values['dry-run'];

const FILES = [
  {
    path: 'package.json',
    rules: [
      { from: /"name": "fullstack-next-template"/, to: `"name": "${SLUG}"` },
    ],
  },
  {
    path: 'docker-compose.yml',
    rules: [
      { from: /ghcr\.io\/rihal-om\/fullstack-next-template/g, to: `ghcr.io/${OWNER}/${SLUG}` },
      { from: /next-template-/g, to: `${SLUG}-` },
    ],
  },
  {
    path: 'docker-compose.prod.yml',
    rules: [
      { from: /ghcr\.io\/rihal-om\/fullstack-next-template/g, to: `ghcr.io/${OWNER}/${SLUG}` },
      { from: /next-template-/g, to: `${SLUG}-` },
      { from: /NEXT_PUBLIC_APP_NAME:-My App/g, to: `NEXT_PUBLIC_APP_NAME:-${NAME}` },
    ],
  },
  {
    path: 'Makefile',
    rules: [
      { from: /ghcr\.io\/rihal-om\/fullstack-next-template/g, to: `ghcr.io/${OWNER}/${SLUG}` },
    ],
  },
  {
    path: '.env.example',
    rules: [
      { from: /NEXT_PUBLIC_APP_NAME="My App"/g, to: `NEXT_PUBLIC_APP_NAME="${NAME}"` },
    ],
  },
  {
    path: 'CLAUDE.md',
    rules: [
      {
        from: /^# CLAUDE\.md — Fullstack Next\.js Template\n\nReusable starter for Rihal internal tools\. Next\.js 16 \+ Prisma 7 \(Postgres\) \+ Auth\.js v5 \+ MinIO \+ Ant Design \+ next-intl\. Deploys as a single Docker image to a Portainer-managed host via GHCR webhook\. Owner: Tariq Al-Naaimi\./m,
        to: `# CLAUDE.md — ${NAME}\n\n${NAME}. Forked from the fullstack-vibe-template (Next.js 16 + Prisma 7 + Auth.js v5 + MinIO + Ant Design + next-intl). Deploys as a single Docker image via GHCR + Portainer webhook. Owner: ${OWNER_NAME}.`,
      },
      {
        from: /\*\*This is the template\.\*\* When you fork it into a project, replace this section with the project-specific intro, owners, environments, and ADR references\. Sections below describe what the template ships out of the box — treat them as defaults to keep, tighten, or replace\.\n\n/,
        to: '',
      },
    ],
  },
];

const diffs = [];

for (const file of FILES) {
  const path = join(ROOT, file.path);
  let src;
  try {
    src = await readFile(path, 'utf8');
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
  console.log('No changes -- template is already rebranded to these values, or no matching strings were found.');
  process.exit(0);
}

if (DRY) {
  console.log('--- DRY RUN ---');
  for (const d of diffs) {
    console.log(`${d.path}: would apply ${d.changedRules} rule(s), delta = ${d.after.length - d.before.length} bytes`);
  }
  console.log('');
  console.log('Re-run without --dry-run to write.');
  process.exit(0);
}

for (const d of diffs) {
  await writeFile(d.path, d.after);
  console.log(`~ ${d.path} (${d.changedRules} rule(s))`);
}

console.log('');
console.log('Rebrand complete. Next:');
console.log(`  git add -A && git commit -m "chore: rebrand to ${SLUG}"`);
console.log('  /first-fork    # finish the bootstrap (secrets, Portainer, branch protection)');
