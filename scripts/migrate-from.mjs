#!/usr/bin/env node
// scripts/migrate-from.mjs
//
// Pull data + schema from a source Postgres into a freshly scaffolded fork.
// Skill-driven: Claude reasons about the column->field mapping, the operator
// reviews it, and this script orchestrates the transfer.
//
// Usage:
//   npm run migrate-from -- --source-db postgresql://... \
//     --target-db postgresql://... \
//     --map /tmp/migrate.json [--dry-run] [--data-only]
//
// Map file shape (operator-edited after Claude proposes):
//   {
//     "tables": [
//       {
//         "source": "employees",
//         "target": "Employee",
//         "where": "deleted_at IS NULL",
//         "columns": {
//           "id": { "to": "id" },
//           "full_name": { "to": "fullName" },
//           "contract_type": { "to": "contractType", "transform": "upper" }
//         }
//       }
//     ]
//   }
//
// Why a separate transform file: the column->field mapping is project-
// specific and rarely round-trips without manual tweaking. Skill prints the
// proposed map to disk; operator opens it, edits, then reruns this script.

import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { step, ok, warn, bail, info, dryPrefix } from './lib/log.mjs';

const { values } = parseArgs({
  options: {
    'source-db': { type: 'string' },
    'target-db': { type: 'string' },
    map: { type: 'string' },
    'data-only': { type: 'boolean', default: false },
    'schema-only': { type: 'boolean', default: false },
    'dump-dir': { type: 'string', default: '/tmp/migrate' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
  strict: true,
});

const DRY = values['dry-run'];
const DRYP = dryPrefix(DRY);

if (!values.map) bail('migrate-from', `--map <path> is required`);
const map = JSON.parse(await readFile(values.map, 'utf8'));
if (!Array.isArray(map.tables)) bail('migrate-from', `map.tables must be an array`);

if (!DRY) {
  if (!values['source-db']) bail('migrate-from', `--source-db is required for non-dry runs`);
  if (!values['target-db']) bail('migrate-from', `--target-db is required for non-dry runs`);
}

// -- 1. Schema introspection ------------------------------------------------

if (!values['data-only']) {
  step('migrate-from', `${DRYP}dumping source schema`);
  if (!DRY) {
    spawnSync('mkdir', ['-p', values['dump-dir']]);
    const tables = map.tables.map(t => `-t ${t.source}`).join(' ');
    const r = spawnSync('bash', ['-c', `pg_dump --schema-only --no-owner ${tables} "${values['source-db']}" > ${values['dump-dir']}/schema.sql`], { stdio: 'inherit' });
    if (r.status !== 0) warn('migrate-from', `pg_dump schema exit ${r.status} -- check that pg_dump is on PATH and the source DB is reachable`);
  }
}

// -- 2. Data dump -----------------------------------------------------------

if (!values['schema-only']) {
  for (const t of map.tables) {
    step('migrate-from', `${DRYP}dumping data: ${t.source}`);
    if (!DRY) {
      const where = t.where ? `WHERE ${t.where}` : '';
      const cols = Object.keys(t.columns).join(', ');
      const sql = `COPY (SELECT ${cols} FROM ${t.source} ${where}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
      const out = `${values['dump-dir']}/${t.source}.csv`;
      const r = spawnSync('bash', ['-c', `psql "${values['source-db']}" -c "${sql.replace(/"/g, '\\"')}" > ${out}`], { stdio: 'inherit' });
      if (r.status !== 0) warn('migrate-from', `psql copy exit ${r.status} for ${t.source}`);
      else ok('migrate-from', `dumped ${t.source} -> ${out}`);
    }
  }
}

// -- 3. Transform + import generator ---------------------------------------
//
// This script doesn't apply transforms in-process. It generates a TypeScript
// seed file that the target Prisma codebase can run via `prisma db seed`,
// which guarantees the same invariants (audit, soft-delete) the rest of the
// app respects.
//
// Why: a streaming-only approach would skip `auditExtension` writes; using
// the target's own Prisma client preserves auditability.

step('migrate-from', `${DRYP}generating prisma seed from CSVs`);
const seedPath = `${values['dump-dir']}/seed.ts`;
const seed = renderSeed(map, values['dump-dir']);
if (!DRY) {
  await writeFile(seedPath, seed);
  ok('migrate-from', `wrote ${seedPath}`);
} else {
  info('migrate-from', `would write ${seedPath} (${seed.split('\n').length} lines)`);
}

console.log('');
ok('migrate-from', `${DRYP}stage 1 complete.`);
console.log(`Next:`);
console.log(`  1. Review ${seedPath} and adjust transforms.`);
console.log(`  2. Copy ${seedPath} into your target repo's prisma/seed.ts.`);
console.log(`  3. cd <target-repo> && DATABASE_URL=${values['target-db'] || '<target>'} npm run prisma:seed`);
console.log(`  4. Validate row counts: pg_dump source counts vs. target Prisma counts.`);

// =========================================================================

function renderSeed(map, dumpDir) {
  const tables = map.tables.map(renderTable).join('\n\n');
  return `// AUTO-GENERATED by scripts/migrate-from.mjs
// Source dump dir: ${dumpDir}
// Edit before running; this script makes guesses about field shapes.

import { prisma } from '@/lib/prisma';
import { readFile } from 'node:fs/promises';
import { parse } from 'node:path';

function parseCSV(s: string) {
  const lines = s.trim().split('\\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? null]));
  });
}

async function main() {
  ${tables}
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
`;
}

function renderTable(t) {
  const target = t.target;
  const csvPath = `${t.source}.csv`;
  const remap = Object.entries(t.columns).map(([src, spec]) => {
    let val = `row['${src}']`;
    if (spec.transform === 'upper') val = `(${val} ?? '').toUpperCase()`;
    if (spec.transform === 'lower') val = `(${val} ?? '').toLowerCase()`;
    if (spec.transform === 'date') val = `${val} ? new Date(${val}) : null`;
    return `    ${spec.to}: ${val},`;
  }).join('\n');
  return `  // ${t.source} -> ${target}
  {
    const raw = await readFile(\`\${import.meta.dirname}/${csvPath}\`, 'utf8');
    const rows = parseCSV(raw);
    for (const row of rows) {
      await prisma.${target[0].toLowerCase() + target.slice(1)}.upsert({
        where: { id: row['id'] },
        update: {},
        create: {
${remap}
        },
      });
    }
    console.log(\`Imported \${rows.length} rows into ${target}\`);
  }`;
}
