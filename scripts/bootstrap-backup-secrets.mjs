#!/usr/bin/env node
// scripts/bootstrap-backup-secrets.mjs
//
// Run inside .github/workflows/bootstrap-secrets.yml. One-click setup of:
//   - BACKUP_AGE_IDENTITY  (age private key)
//   - BACKUP_AGE_RECIPIENT (age public key, matched pair)
//   - RCLONE_CONFIG        (DO Spaces rclone.conf)
//
// All three land as libsodium-encrypted GH repo secrets so subsequent
// `/deploy` runs can substitute them into cloud-init. Operator never
// touches a terminal.
//
// Idempotent by default: skips secrets that already exist. Set
// INPUT_REGENERATE=true to overwrite (rotates age keypair -- old
// backups become undecryptable -- so use only when starting fresh).

import { spawnSync } from 'node:child_process';
import { ok, step, warn, bail, err } from './lib/log.mjs';
import * as GH from './lib/github.mjs';

process.on('unhandledRejection', (e) => { err('bootstrap', `unhandled: ${e && e.stack || e}`); process.exit(1); });
process.on('uncaughtException',  (e) => { err('bootstrap', `uncaught: ${e && e.stack || e}`); process.exit(1); });

const DO_TOKEN = process.env.DO_API_TOKEN || '';
const GH_TOKEN = process.env.GH_AUTOMATION_TOKEN || '';
const REPO     = process.env.GITHUB_REPOSITORY || '';
const REGION   = process.env.INPUT_REGION || 'fra1';
const REGEN    = String(process.env.INPUT_REGENERATE || '').toLowerCase() === 'true';

if (!DO_TOKEN) bail('bootstrap', 'DO_API_TOKEN secret is unset.');
if (!GH_TOKEN) bail('bootstrap', 'GH_AUTOMATION_TOKEN secret is unset.');
if (!REPO.includes('/')) bail('bootstrap', `GITHUB_REPOSITORY must be owner/repo; got "${REPO}"`);

const [OWNER, REPO_NAME] = REPO.split('/');

// -- Helpers ---------------------------------------------------------------

async function secretExists(name) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO_NAME}/actions/secrets/${name}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  return r.status === 200;
}

async function generateAgeKeypair() {
  const r = spawnSync('age-keygen', [], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`age-keygen failed: ${r.stderr || r.stdout}`);
  // age-keygen output:
  //   # created: 2026-05-18T19:30:00Z
  //   # public key: age1xxxxxxxx...
  //   AGE-SECRET-KEY-1xxxxxxxx...
  const identity = r.stdout.trim().split('\n').filter(l => !l.startsWith('#')).join('\n').trim();
  const pubMatch = r.stdout.match(/^#\s*public key:\s*(age1\S+)\s*$/m);
  if (!identity || !pubMatch) throw new Error('age-keygen output unexpected; identity or recipient missing');
  return { identity, recipient: pubMatch[1] };
}

async function createSpacesAccessKey(name) {
  // DigitalOcean Spaces API: POST /v2/spaces/keys creates an access key.
  // Body: { name: <human-readable>, grants: [{ permission: 'fullaccess' | 'read' | 'readwrite' }] }
  // Returns: { spaces_key: { access_key, secret_key, name, ... } }
  const r = await fetch('https://api.digitalocean.com/v2/spaces/keys', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DO_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, grants: [{ permission: 'fullaccess', bucket: '' }] }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`DO POST /v2/spaces/keys -> ${r.status}: ${body}`);
  }
  const body = await r.json();
  // The response shape varies by DO API version; tolerate both.
  const key = body.spaces_key || body.key || body;
  if (!key.access_key || !key.secret_key) {
    throw new Error(`DO Spaces key response missing access_key/secret_key: ${JSON.stringify(body)}`);
  }
  return { accessKey: key.access_key, secretKey: key.secret_key };
}

function buildRcloneConfig({ accessKey, secretKey, region }) {
  return `[spaces]
type = s3
provider = DigitalOcean
env_auth = false
access_key_id = ${accessKey}
secret_access_key = ${secretKey}
endpoint = ${region}.digitaloceanspaces.com
acl = private
`;
}

// -- Main ------------------------------------------------------------------

step('bootstrap', `target repo: ${OWNER}/${REPO_NAME}; region: ${REGION}; regenerate: ${REGEN}`);

// Check which secrets already exist.
const ageExists      = await secretExists('BACKUP_AGE_IDENTITY');
const recipExists    = await secretExists('BACKUP_AGE_RECIPIENT');
const rcloneExists   = await secretExists('RCLONE_CONFIG');

step('bootstrap', `existing -> identity:${ageExists} recipient:${recipExists} rclone:${rcloneExists}`);

// -- age keypair -----------------------------------------------------------

if ((ageExists || recipExists) && !REGEN) {
  ok('bootstrap', 'age secrets already set; skipping. Re-run with regenerate=true to rotate.');
} else {
  step('bootstrap', 'generating age keypair');
  const { identity, recipient } = await generateAgeKeypair();
  await GH.setRepoSecret(GH_TOKEN, OWNER, REPO_NAME, 'BACKUP_AGE_IDENTITY',  identity);
  await GH.setRepoSecret(GH_TOKEN, OWNER, REPO_NAME, 'BACKUP_AGE_RECIPIENT', recipient);
  ok('bootstrap', `set BACKUP_AGE_IDENTITY + BACKUP_AGE_RECIPIENT (recipient: ${recipient})`);
}

// -- DO Spaces access key + rclone.conf ------------------------------------

if (rcloneExists && !REGEN) {
  ok('bootstrap', 'RCLONE_CONFIG already set; skipping. Re-run with regenerate=true to rotate.');
} else {
  step('bootstrap', `creating DO Spaces access key (region: ${REGION})`);
  const keyName = `vibe-template-${OWNER.toLowerCase()}-${Date.now()}`;
  try {
    const { accessKey, secretKey } = await createSpacesAccessKey(keyName);
    const rcloneConf = buildRcloneConfig({ accessKey, secretKey, region: REGION });
    await GH.setRepoSecret(GH_TOKEN, OWNER, REPO_NAME, 'RCLONE_CONFIG', rcloneConf);
    ok('bootstrap', `set RCLONE_CONFIG (access_key: ${accessKey})`);
  } catch (e) {
    warn('bootstrap', `Spaces key creation failed: ${e.message}`);
    warn('bootstrap', `DO Spaces management API may not be available on this account or token scope.`);
    warn('bootstrap', `Fallback: create the key manually at https://cloud.digitalocean.com/account/api/spaces,`);
    warn('bootstrap', `then set RCLONE_CONFIG secret manually via the GH UI with this content:`);
    warn('bootstrap', `[spaces]`);
    warn('bootstrap', `type = s3`);
    warn('bootstrap', `provider = DigitalOcean`);
    warn('bootstrap', `env_auth = false`);
    warn('bootstrap', `access_key_id = <your-access-key>`);
    warn('bootstrap', `secret_access_key = <your-secret-key>`);
    warn('bootstrap', `endpoint = ${REGION}.digitaloceanspaces.com`);
    warn('bootstrap', `acl = private`);
    process.exit(1);
  }
}

console.log('');
ok('bootstrap', `done. Next: dispatch deploy.yml.`);
console.log(`  Public age recipient is visible above (safe to share).`);
console.log(`  The private identity is set as BACKUP_AGE_IDENTITY -- never log it.`);
console.log(`  To rotate later: dispatch this workflow with regenerate=true.`);
console.log('');
