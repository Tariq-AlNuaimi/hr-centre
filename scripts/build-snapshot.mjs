#!/usr/bin/env node
// scripts/build-snapshot.mjs
//
// Builds a custom DigitalOcean snapshot with Docker + Caddy + age + rclone
// pre-installed, plus pre-pulled Docker base images that every fork uses.
//
// Subsequent /deploy runs read DO_BASE_SNAPSHOT_ID_<REGION> from repo variables
// and boot droplets from this snapshot, skipping the ~4 min apt-install phase
// of the per-deploy cloud-init.
//
// Usage:
//   gh workflow run build-snapshot.yml -f region=fra1
//   # or locally:
//   node scripts/build-snapshot.mjs --region fra1 --yes
//
// One-time cost: ~6-9 min (~3 min cloud-init apt install + ~3-6 min snapshot
// creation). Subsequent deploys recoup 3-5 min each.
//
// Idempotent: if a snapshot named "vibe-base-<region>" already exists, the
// script just (re)sets the repo variable and exits. Use --force-rebuild to
// destroy and rebuild.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { step, ok, warn, err, bail, dim } from './lib/log.mjs';
import * as DO from './lib/do.mjs';
import * as GH from './lib/github.mjs';
import * as SSH from './lib/ssh-deploy.mjs';
import { validateSshPubkey } from './lib/secrets.mjs';

const ROOT = process.cwd();
const CI = process.env.CI === 'true' || process.env.NON_INTERACTIVE === 'true';

process.on('unhandledRejection', (e) => {
  err('snapshot', `unhandled rejection: ${e && e.stack || e}`);
  process.exit(1);
});

const { values } = parseArgs({
  options: {
    region: { type: 'string', default: DO.DEFAULTS.region },
    'do-token': { type: 'string' },
    'gh-token': { type: 'string' },
    'gh-owner': { type: 'string' },
    'gh-repo': { type: 'string' },
    'ssh-pubkey': { type: 'string' },
    'ssh-key-path': { type: 'string', default: process.env.HOME ? `${process.env.HOME}/.ssh/id_ed25519` : '' },
    'force-rebuild': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('node scripts/build-snapshot.mjs --region <region> [--force-rebuild] [--yes] [--dry-run]');
  process.exit(0);
}

if (CI) {
  values['do-token']    ||= process.env.DO_API_TOKEN || '';
  values['gh-token']    ||= process.env.GH_AUTOMATION_TOKEN || process.env.GITHUB_AUTOMATION_TOKEN || process.env.GITHUB_TOKEN || '';
  values['ssh-pubkey']  ||= process.env.SSH_PUBKEY || '';
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.includes('/')) {
    const [o, r] = process.env.GITHUB_REPOSITORY.split('/');
    values['gh-owner'] ||= o;
    values['gh-repo']  ||= r;
  }
}

const DRY = values['dry-run'];
const REGION = values.region;
const SNAPSHOT_NAME = `vibe-base-${REGION}`;
const REGION_UPPER = REGION.toUpperCase().replace(/-/g, '_');
const VAR_NAME = `DO_BASE_SNAPSHOT_ID_${REGION_UPPER}`;

if (!/^[a-z][a-z0-9-]*\d?$/.test(REGION)) bail('snapshot', `--region "${REGION}" must be a DO region slug (e.g. fra1, nyc3)`);

if (CI && !values.yes && !DRY) bail('snapshot', `CI mode requires --yes`);

// Required inputs ------------------------------------------------------------
const required = [];
if (!DRY) required.push('do-token', 'gh-token', 'ssh-pubkey');
const missing = required.filter(k => !values[k]);
if (missing.length) bail('snapshot', `missing required args: ${missing.map(m => `--${m}`).join(', ')}`);

if (values['ssh-pubkey'] && !validateSshPubkey(values['ssh-pubkey'])) {
  bail('snapshot', `--ssh-pubkey doesn't look like a valid ssh public key`);
}

// Resolve GH repo from CLI flags, then env, then git remote.
async function resolveRepo() {
  if (values['gh-owner'] && values['gh-repo']) return { owner: values['gh-owner'], repo: values['gh-repo'] };
  try {
    const { execSync } = await import('node:child_process');
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^:/]+)\/([^/.]+?)(?:\.git)?$/);
    if (m) return { owner: m[1], repo: m[2] };
  } catch (_) {}
  bail('snapshot', `could not derive GH repo; pass --gh-owner + --gh-repo`);
}
const { owner: GH_OWNER, repo: GH_REPO } = await resolveRepo();

// Cost preview ---------------------------------------------------------------
console.log('');
console.log(`Build base snapshot for ${REGION}:`);
console.log(`  Temp droplet:     s-1vcpu-2gb in ${REGION} (~$0.02 for ~10 min runtime)`);
console.log(`  Snapshot:         "${SNAPSHOT_NAME}" (~3-4 GB, ~$0.20/mo storage)`);
console.log(`  Repo variable:    ${VAR_NAME} on ${GH_OWNER}/${GH_REPO}`);
console.log(`  Expected runtime: 6-9 minutes total`);
console.log('');

// Validate tokens upfront ----------------------------------------------------
if (!DRY) {
  step('snapshot', `validating tokens`);
  await DO.validateToken(values['do-token']).then(a => ok('snapshot', `DO ok (${a.email || a.uuid})`));
  await GH.validateToken(values['gh-token'], { owner: GH_OWNER, repo: GH_REPO }).then(u => ok('snapshot', `GH ok (${u.login})`));
}

// Idempotency: existing snapshot? --------------------------------------------
if (!DRY) {
  const existing = await DO.findSnapshotByName(values['do-token'], SNAPSHOT_NAME);
  if (existing) {
    if (values['force-rebuild']) {
      warn('snapshot', `existing snapshot ${existing.id} ("${SNAPSHOT_NAME}") will be destroyed`);
      await DO.destroySnapshot(values['do-token'], existing.id);
      ok('snapshot', `destroyed existing snapshot ${existing.id}`);
    } else {
      ok('snapshot', `snapshot "${SNAPSHOT_NAME}" already exists as ID ${existing.id}; reusing.`);
      step('snapshot', `setting repo variable ${VAR_NAME}=${existing.id}`);
      await GH.setRepoVariable(values['gh-token'], GH_OWNER, GH_REPO, VAR_NAME, String(existing.id));
      ok('snapshot', `${VAR_NAME} set on ${GH_OWNER}/${GH_REPO}.`);
      console.log('');
      console.log(`No work to do. Pass --force-rebuild to recreate (e.g. to refresh base packages).`);
      process.exit(0);
    }
  }
} else {
  dim('snapshot', `would check for existing snapshot "${SNAPSHOT_NAME}"`);
}

if (DRY) {
  dim('snapshot', `would: ensure SSH key, create temp droplet, wait for cloud-init, power off, snapshot, set ${VAR_NAME}, destroy temp droplet.`);
  process.exit(0);
}

// Render base cloud-init -----------------------------------------------------
const userData = await readFile(join(ROOT, 'deploy/cloud-init-base.yml'), 'utf8');

// Ensure SSH key + create temp droplet ---------------------------------------
step('snapshot', `ensuring SSH key on DO`);
const sshKey = await DO.ensureSshKey(values['do-token'], 'vibe-base-snapshot-builder', values['ssh-pubkey']);
ok('snapshot', `SSH key ID ${sshKey.id}`);

const dropletName = `vibe-snapshot-build-${REGION}-${Date.now()}`;
const startedAt = Date.now();

step('snapshot', `creating temp droplet ${dropletName}`);
const droplet = await DO.createDroplet(values['do-token'], {
  name: dropletName,
  region: REGION,
  size: 's-1vcpu-2gb',
  sshKeyId: sshKey.id,
  tags: ['vibe-snapshot-build', `vibe-snapshot-build-${REGION}`],
  userData,
  // image: undefined -> stock Ubuntu 22.04
});

const { droplet: ready, ip } = await DO.waitForDropletActive(values['do-token'], droplet.id);
ok('snapshot', `droplet ${ready.id} active @ ${ip}`);

// Wait for cloud-init to finish (it ends with `shutdown -P now`) -------------
// The cloud-init's last step powers off the droplet, so the SSH session will
// likely terminate mid-stream. We poll the droplet status for 'off' instead
// of relying on a stable SSH session.
step('snapshot', `waiting for droplet to power off (signals cloud-init complete)`);
try {
  // Best-effort: stream cloud-init status until SSH dies.
  await SSH.waitForSsh(ip, 'root', values['ssh-key-path'], 120_000);
  ok('snapshot', `SSH reachable`);
} catch (e) {
  warn('snapshot', `SSH not reachable (cloud-init may have finished + powered off already): ${e.message}`);
}

// Poll droplet status until 'off'. Cloud-init takes ~3-4 min on a 2GB
// droplet to install Docker + Caddy + pull base images.
await DO.waitForDropletStatus(values['do-token'], ready.id, 'off', 720_000);
ok('snapshot', `droplet ${ready.id} powered off after ${Math.round((Date.now() - startedAt) / 1000)}s`);

// Create the snapshot --------------------------------------------------------
step('snapshot', `taking snapshot "${SNAPSHOT_NAME}" (3-6 min)`);
const action = await DO.createSnapshot(values['do-token'], ready.id, SNAPSHOT_NAME);
await DO.waitForDropletActionComplete(values['do-token'], ready.id, action.id, 900_000);
ok('snapshot', `snapshot action ${action.id} completed`);

// Find the snapshot ID (action doesn't return resource id reliably) ----------
const snap = await DO.findSnapshotByName(values['do-token'], SNAPSHOT_NAME);
if (!snap) bail('snapshot', `action completed but snapshot "${SNAPSHOT_NAME}" not found in /snapshots listing`);
ok('snapshot', `snapshot ID ${snap.id} (${snap.size_gigabytes} GB)`);

// Set the repo variable ------------------------------------------------------
step('snapshot', `setting repo variable ${VAR_NAME}=${snap.id}`);
await GH.setRepoVariable(values['gh-token'], GH_OWNER, GH_REPO, VAR_NAME, String(snap.id));
ok('snapshot', `${VAR_NAME} set on ${GH_OWNER}/${GH_REPO}`);

// Destroy temp droplet -------------------------------------------------------
step('snapshot', `destroying temp droplet ${ready.id}`);
await DO.destroyDroplet(values['do-token'], ready.id);
ok('snapshot', `temp droplet destroyed`);

// Done -----------------------------------------------------------------------
const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log('');
ok('snapshot', `base snapshot ready in ${elapsed}s`);
console.log(`  Snapshot:        ${SNAPSHOT_NAME} (ID ${snap.id}, ${snap.size_gigabytes} GB)`);
console.log(`  Repo variable:   ${VAR_NAME}=${snap.id}`);
console.log(`  Next deploys to ${REGION} will boot from this snapshot (~3-5 min faster).`);
console.log('');
console.log(`  Refresh: re-run with --force-rebuild after Docker / Caddy security updates (~quarterly).`);
console.log('');
