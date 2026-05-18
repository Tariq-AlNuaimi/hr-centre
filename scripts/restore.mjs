#!/usr/bin/env node
// scripts/restore.mjs
//
// Pull a backup dump from the off-host rclone remote, decrypt with
// BACKUP_AGE_IDENTITY, restore into a NEW Postgres instance (never live).
//
// Usage:
//   npm run restore -- --env prod --pick latest [--into-port 5433]
//   npm run restore -- --env prod --pick 2026-05-15.dump.age
//
// Safety: this script never writes to the live DB. The default is to bring
// up an ephemeral Postgres container on a non-standard port and print the
// connection string. Operator decides whether to swap. The --hot-swap flag
// is intentionally NOT implemented in this iteration -- restore-into-live
// belongs in a runbook, not a one-flag script.

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { step, ok, warn, bail, info, err, dryPrefix } from './lib/log.mjs';
import { readState } from './lib/state.mjs';

const CI = process.env.CI === 'true' || process.env.NON_INTERACTIVE === 'true';

process.on('unhandledRejection', (e) => { err('restore', `unhandled rejection: ${e && e.stack || e}`); process.exit(1); });
process.on('uncaughtException',  (e) => { err('restore', `uncaught exception: ${e && e.stack || e}`); process.exit(1); });

const { values } = parseArgs({
  options: {
    env: { type: 'string', default: 'prod' },
    pick: { type: 'string', default: 'latest' },
    slug: { type: 'string' },
    'into-port': { type: 'string', default: '5433' },
    'rclone-remote': { type: 'string' },
    'backup-bucket': { type: 'string' },
    'age-identity-path': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
  strict: true,
});

const DRY = values['dry-run'];
const DRYP = dryPrefix(DRY);

const state = await readState(values.env).catch(() => null);
if (!state) warn('restore', `no state file for env=${values.env}; relying on flags`);

const remote = values['rclone-remote'] || (state && state.spaces && state.spaces.bucket && 'spaces') || 'spaces';
const bucket = values['backup-bucket'] || (state && state.spaces && state.spaces.bucket) || `${state && state.slug ? state.slug : '<slug>'}-backups-${values.env}`;
const idPath = values['age-identity-path'] || `/opt/backup/keys/${values.env}.identity`;

// -- 1. List + pick ---------------------------------------------------------

step('restore', `${DRYP}listing ${remote}:${bucket}`);
let pick = values.pick;
if (!DRY) {
  const r = spawnSync('rclone', ['lsf', `${remote}:${bucket}`, '--include', '*.dump.age'], { encoding: 'utf8' });
  if (r.status !== 0) bail('restore', `rclone lsf failed: ${r.stderr}`);
  const files = r.stdout.split('\n').filter(Boolean).sort();
  if (files.length === 0) bail('restore', `no *.dump.age found on remote`);
  if (pick === 'latest') pick = files[files.length - 1];
  if (!files.includes(pick)) bail('restore', `pick "${pick}" not found. Available:\n${files.join('\n')}`);
  ok('restore', `selected ${pick} (${files.length} dumps on remote)`);
}

// -- 2. Download ------------------------------------------------------------

const localDump = `/tmp/restore-${values.env}-${Date.now()}.dump.age`;
step('restore', `${DRYP}downloading ${pick} -> ${localDump}`);
if (!DRY) {
  const r = spawnSync('rclone', ['copyto', `${remote}:${bucket}/${pick}`, localDump], { stdio: 'inherit' });
  if (r.status !== 0) bail('restore', `rclone download failed`);
}

// -- 3. Decrypt -------------------------------------------------------------

const plainDump = localDump.replace(/\.age$/, '');
step('restore', `${DRYP}decrypting via age -i ${idPath}`);
if (!DRY) {
  const r = spawnSync('bash', ['-c', `age -d -i "${idPath}" "${localDump}" > "${plainDump}"`], { stdio: 'inherit' });
  if (r.status !== 0) bail('restore', `age decrypt failed -- check identity path`);
}

// -- 4. Bring up ephemeral Postgres -----------------------------------------

const container = `restore-${values.env}-${Date.now()}`;
const port = values['into-port'];
step('restore', `${DRYP}starting ephemeral Postgres on :${port}`);
if (!DRY) {
  const r = spawnSync('docker', ['run', '-d', '--name', container,
    '-e', 'POSTGRES_PASSWORD=restore', '-e', 'POSTGRES_USER=restore', '-e', 'POSTGRES_DB=restore',
    '-p', `${port}:5432`, 'postgres:17-alpine'], { stdio: 'inherit' });
  if (r.status !== 0) bail('restore', `docker run failed`);
  // Wait for Postgres
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const check = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'restore'], { encoding: 'utf8' });
    if (check.status === 0) { ready = true; break; }
    await new Promise(res => setTimeout(res, 1000));
  }
  if (!ready) bail('restore', `postgres in ${container} did not become ready`);
}

// -- 5. pg_restore ----------------------------------------------------------

step('restore', `${DRYP}pg_restore into restore DB`);
if (!DRY) {
  const r = spawnSync('bash', ['-c', `pg_restore --no-owner --no-privileges -d "postgresql://restore:restore@127.0.0.1:${port}/restore" "${plainDump}"`], { stdio: 'inherit' });
  if (r.status !== 0) warn('restore', `pg_restore exit ${r.status} -- it may have completed with non-fatal warnings (objects already exist etc.)`);
}

// -- 6. Validate ------------------------------------------------------------

if (!DRY) {
  step('restore', `validating: count users`);
  const r = spawnSync('docker', ['exec', container, 'psql', '-U', 'restore', '-d', 'restore', '-tAc', 'SELECT count(*) FROM users'], { encoding: 'utf8' });
  if (r.status === 0) ok('restore', `users.count = ${r.stdout.trim()}`);
  else warn('restore', `users count query failed: ${r.stderr}`);
}

console.log('');
ok('restore', `${DRYP}restore complete.`);
console.log(`  Connection: postgresql://restore:restore@127.0.0.1:${port}/restore`);
console.log(`  Container:  ${container}`);
console.log(`  Cleanup:    docker rm -f ${container} && rm ${localDump} ${plainDump}`);
console.log('');
console.log(`To hot-swap into the live stack: edit the Portainer stack DATABASE_URL`);
console.log(`and re-deploy. NEVER do this without first checking the restore DB looks right.`);
