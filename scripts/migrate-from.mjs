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
import { openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { step, ok, bail, info, dryPrefix } from './lib/log.mjs';

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

// Identifiers (table + column names) are interpolated into pg_dump -t flags,
// the COPY ... TO STDOUT SQL, and a bash -c string. None of those contexts is
// escaped, so anything other than a plain SQL identifier is an injection
// surface. Validate every table/column up front and reject the whole run on
// the first bad one -- never reach for a shell-quoting band-aid.
const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function assertIdent(kind, value) {
  if (typeof value !== 'string' || !IDENT_RE.test(value)) {
    bail('migrate-from', `invalid ${kind} ${JSON.stringify(value)} -- must match ${IDENT_RE}. Refusing to run (injection guard).`);
  }
  return value;
}

for (const t of map.tables) {
  assertIdent('source table', t.source);
  if (typeof t.target !== 'string' || !IDENT_RE.test(t.target)) {
    bail('migrate-from', `invalid target model ${JSON.stringify(t.target)} for table ${JSON.stringify(t.source)}.`);
  }
  if (!t.columns || typeof t.columns !== 'object') {
    bail('migrate-from', `table ${JSON.stringify(t.source)} is missing a "columns" map.`);
  }
  for (const col of Object.keys(t.columns)) assertIdent('column', col);

  // t.where is a free SQL predicate, not an identifier, so it can't match
  // IDENT_RE. It still lands unescaped inside both the COPY SQL and the bash
  // -c string, so reject the metacharacters that would let it break out of
  // either context (quotes, statement separators, command substitution, ...).
  if (t.where != null) {
    if (typeof t.where !== 'string') {
      bail('migrate-from', `table ${JSON.stringify(t.source)}: "where" must be a string.`);
    }
    if (/["'`;$\\\n\r]|--|\/\*|\*\//.test(t.where)) {
      bail('migrate-from', `table ${JSON.stringify(t.source)}: "where" contains forbidden characters (quotes, ; $ \\ backtick, comment markers). Refusing to run (injection guard).`);
    }
  }
}

if (!DRY) {
  if (!values['source-db']) bail('migrate-from', `--source-db is required for non-dry runs`);
  if (!values['target-db']) bail('migrate-from', `--target-db is required for non-dry runs`);
}

// -- 1. Schema introspection ------------------------------------------------

if (!values['data-only']) {
  step('migrate-from', `${DRYP}dumping source schema`);
  if (!DRY) {
    spawnSync('mkdir', ['-p', values['dump-dir']]);
    // Pass every value as a discrete argv element and redirect stdout to the
    // file via an fd -- no `bash -c` string, so a shell metacharacter in
    // --tables / --source-db / --dump-dir can't break out or inject commands.
    const tableArgs = map.tables.flatMap(t => ['-t', t.source]);
    const schemaFd = openSync(`${values['dump-dir']}/schema.sql`, 'w');
    let r;
    try {
      r = spawnSync(
        'pg_dump',
        ['--schema-only', '--no-owner', ...tableArgs, values['source-db']],
        { stdio: ['ignore', schemaFd, 'inherit'] }
      );
    } finally {
      closeSync(schemaFd);
    }
    if (r.error?.code === 'ENOENT') {
      bail('migrate-from', `could not spawn pg_dump (${r.error.message}); is it on PATH?`);
    }
    if (r.status !== 0) {
      // A non-zero exit means we'd otherwise leave an empty/partial schema.sql
      // behind and report success. Hard-fail so the operator notices.
      bail('migrate-from', `pg_dump schema failed (exit ${r.status}) -- check that pg_dump is on PATH and the source DB is reachable.`);
    }
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
      // psql connection string and -c SQL are discrete argv elements; stdout is
      // redirected to the CSV via an fd. No shell, so no `"`-escaping dance and
      // no interpolation of --source-db / --dump-dir into a command string.
      const csvFd = openSync(out, 'w');
      let r;
      try {
        r = spawnSync(
          'psql',
          [values['source-db'], '-c', sql],
          { stdio: ['ignore', csvFd, 'inherit'] }
        );
      } finally {
        closeSync(csvFd);
      }
      if (r.error?.code === 'ENOENT') {
        bail('migrate-from', `could not spawn psql (${r.error.message}); is it on PATH?`);
      }
      if (r.status !== 0) {
        // Don't continue: a failed COPY leaves an empty CSV that the seed would
        // happily "import" as zero rows, masking the failure.
        bail('migrate-from', `psql COPY failed (exit ${r.status}) for ${t.source} -- check that psql is on PATH and the source DB is reachable.`);
      }
      ok('migrate-from', `dumped ${t.source} -> ${out}`);
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

// Minimal RFC-4180 CSV parser. The COPY ... TO STDOUT CSV output uses standard
// quoting: fields containing a comma, double-quote, or newline are wrapped in
// double-quotes, and embedded double-quotes are doubled (""). A naive
// line.split(',') corrupts any such value, so honor the quoting here.
function parseCSV(s: string): Record<string, string | null>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\\r') { i++; continue; }
    if (c === '\\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
    field += c; i++;
  }
  // Flush the final field/row if the file doesn't end in a newline.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1)
    // A trailing newline produces one empty row; drop blank lines.
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) => Object.fromEntries(header.map((h, idx) => [h, cells[idx] ?? null])));
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
      // Insert-or-skip: \`update: {}\` means re-running this seed never mutates
      // rows that already exist (matched by id) -- only missing rows are created.
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
