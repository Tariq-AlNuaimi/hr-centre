#!/usr/bin/env node
// scripts/preflight.mjs
//
// Validates every secret / variable that /deploy needs, in ~30s, by hitting
// the real vendor APIs. Surfaces "missing", "invalid", "mis-scoped", and
// "pair-mismatch" before deploy.yml ever provisions anything.
//
// Two tiers per env:
//   staging  -> 7 required secrets, 2 variables
//   prod     -> staging + BACKUP_AGE_RECIPIENT + BACKUP_AGE_IDENTITY + RCLONE_CONFIG
//
// Exit 0 = all required-for-env secrets pass. Exit 1 = at least one missing
// or invalid.
//
// Usage (local):
//   DO_API_TOKEN=... CLOUDFLARE_API_TOKEN=... ... \
//     node scripts/preflight.mjs --env staging --domain app.staging.example.com
//
// In CI, .github/workflows/preflight.yml passes the env vars from
// repo/environment secrets. Operator dispatches `gh workflow run preflight.yml`.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import * as DO from './lib/do.mjs';
import * as CF from './lib/cloudflare.mjs';
import * as GH from './lib/github.mjs';
import { validateSshPubkey } from './lib/secrets.mjs';

const { values } = parseArgs({
  options: {
    env: { type: 'string' },
    domain: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('node scripts/preflight.mjs --env <staging|prod> [--domain app.example.com]');
  process.exit(0);
}

const ENV = values.env;
if (!ENV || !/^[a-z][a-z0-9-]*$/.test(ENV)) {
  console.error('preflight: --env is required (kebab-case, e.g. staging, prod)');
  process.exit(2);
}
const DOMAIN = values.domain || '';
const IS_PROD = ENV === 'prod';

// ANSI helpers (mirror lib/log.mjs but standalone so preflight has no side-deps).
const tty = process.stdout.isTTY === true;
const C = {
  reset: tty ? '\x1b[0m' : '',
  dim:   tty ? '\x1b[2m' : '',
  bold:  tty ? '\x1b[1m' : '',
  red:   tty ? '\x1b[31m' : '',
  green: tty ? '\x1b[32m' : '',
  yellow:tty ? '\x1b[33m' : '',
  cyan:  tty ? '\x1b[36m' : '',
};
const ICON = { pass: '✓', fail: '✗', skip: '-' };

// Each row: { tier: 'required'|'prod-only'|'optional', name, status: 'pass'|'fail'|'skip', detail, remedy? }
const rows = [];
function row(tier, name, status, detail, remedy) {
  rows.push({ tier, name, status, detail, remedy });
}

// Read every secret/variable up front. Empty string => not set.
const env = {
  DO_API_TOKEN:           process.env.DO_API_TOKEN || '',
  CLOUDFLARE_API_TOKEN:   process.env.CLOUDFLARE_API_TOKEN || '',
  GH_AUTOMATION_TOKEN:    process.env.GH_AUTOMATION_TOKEN || '',
  SSH_PRIVATE_KEY:        process.env.SSH_PRIVATE_KEY || '',
  SSH_PUBKEY:             process.env.SSH_PUBKEY || '',
  CADDY_EMAIL:            process.env.CADDY_EMAIL || '',
  GHCR_PULL_TOKEN:        process.env.GHCR_PULL_TOKEN || '',
  BACKUP_AGE_RECIPIENT:   process.env.BACKUP_AGE_RECIPIENT || '',
  BACKUP_AGE_IDENTITY:    process.env.BACKUP_AGE_IDENTITY || '',
  RCLONE_CONFIG:          process.env.RCLONE_CONFIG || '',
  SENTRY_DSN:             process.env.SENTRY_DSN || '',
  BETTER_UPTIME_API_KEY:  process.env.BETTER_UPTIME_API_KEY || '',
};

// Resolve repo owner/name from GITHUB_REPOSITORY (CI) or git remote (local).
async function resolveOwnerRepo() {
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.includes('/')) {
    const [o, r] = process.env.GITHUB_REPOSITORY.split('/');
    return { owner: o, repo: r };
  }
  try {
    const url = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).stdout.trim();
    const m = url.match(/[:/]([^:/]+)\/([^/.]+?)(?:\.git)?$/);
    if (m) return { owner: m[1], repo: m[2] };
  } catch {}
  return { owner: '', repo: '' };
}

const { owner: GH_OWNER, repo: GH_REPO } = await resolveOwnerRepo();

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkDoToken() {
  if (!env.DO_API_TOKEN) {
    row('required', 'DO_API_TOKEN', 'fail', 'not set',
        `gh secret set DO_API_TOKEN -b 'dop_v1_...' (mint at cloud.digitalocean.com → API → Tokens, full scope)`);
    return;
  }
  try {
    const a = await DO.validateToken(env.DO_API_TOKEN);
    row('required', 'DO_API_TOKEN', 'pass', `account: ${a.email || a.uuid}`);
  } catch (e) {
    row('required', 'DO_API_TOKEN', 'fail', truncate(e.message),
        `Re-mint a full-account DO PAT and update the secret.`);
  }
}

async function checkCfToken() {
  if (!env.CLOUDFLARE_API_TOKEN) {
    row('required', 'CLOUDFLARE_API_TOKEN', 'fail', 'not set',
        `gh secret set CLOUDFLARE_API_TOKEN -b '...' (Zone.DNS:Edit on the project zone)`);
    return;
  }
  try {
    const t = await CF.validateToken(env.CLOUDFLARE_API_TOKEN);
    let detail = `status=${t.status}`;
    if (DOMAIN) {
      try {
        const zoneName = CF.rootDomain(DOMAIN);
        const zone = await CF.findZoneByName(env.CLOUDFLARE_API_TOKEN, zoneName);
        if (!zone) {
          row('required', 'CLOUDFLARE_API_TOKEN', 'fail',
              `token valid but zone "${zoneName}" not found on this account`,
              `Move the domain to this CF account, OR re-scope the token to the right zone, OR pass --cf-zone explicitly at deploy time.`);
          return;
        }
        detail += `; zone "${zoneName}" reachable`;
      } catch (e) {
        row('required', 'CLOUDFLARE_API_TOKEN', 'fail',
            `token valid but zone lookup failed: ${truncate(e.message)}`,
            `Check the token scope includes Zone.DNS:Read on the target zone.`);
        return;
      }
    }
    row('required', 'CLOUDFLARE_API_TOKEN', 'pass', detail);
  } catch (e) {
    row('required', 'CLOUDFLARE_API_TOKEN', 'fail', truncate(e.message),
        `Re-mint a CF token at dash.cloudflare.com → Profile → API Tokens with Zone.DNS:Edit on the project zone.`);
  }
}

async function checkGhToken() {
  if (!env.GH_AUTOMATION_TOKEN) {
    row('required', 'GH_AUTOMATION_TOKEN', 'fail', 'not set',
        `gh secret set GH_AUTOMATION_TOKEN -b 'ghp_...' (PAT with repo + workflow scopes)`);
    return;
  }
  if (!GH_OWNER || !GH_REPO) {
    // Token format check only; can't probe secrets:write without owner/repo.
    try {
      const u = await GH.validateToken(env.GH_AUTOMATION_TOKEN);
      row('required', 'GH_AUTOMATION_TOKEN', 'pass', `user: ${u.login} (owner/repo not resolvable; secrets:write not probed)`);
    } catch (e) {
      row('required', 'GH_AUTOMATION_TOKEN', 'fail', truncate(e.message),
          `Re-mint a classic PAT with repo + workflow scopes, OR a fine-grained PAT with contents:rw, secrets:rw, administration:rw, actions:rw, workflows.`);
    }
    return;
  }
  try {
    const u = await GH.validateToken(env.GH_AUTOMATION_TOKEN, { owner: GH_OWNER, repo: GH_REPO });
    row('required', 'GH_AUTOMATION_TOKEN', 'pass', `user: ${u.login}; secrets:write OK on ${GH_OWNER}/${GH_REPO}`);
  } catch (e) {
    row('required', 'GH_AUTOMATION_TOKEN', 'fail', truncate(e.message),
        `Re-mint a PAT; ensure scopes/permissions include secrets:write on this repo. See .claude/skills/first-fork/SKILL.md §3.`);
  }
}

function checkSshPair() {
  if (!env.SSH_PRIVATE_KEY) {
    row('required', 'SSH_PRIVATE_KEY', 'fail', 'not set',
        `ssh-keygen -t ed25519 -f /tmp/ops -N '' && gh secret set SSH_PRIVATE_KEY < /tmp/ops`);
  }
  if (!env.SSH_PUBKEY) {
    row('required', 'SSH_PUBKEY (variable)', 'fail', 'not set',
        `gh variable set SSH_PUBKEY -b "$(cat /tmp/ops.pub)"`);
  }
  if (!env.SSH_PRIVATE_KEY || !env.SSH_PUBKEY) return;

  // Validate the public key shape first (cheap).
  if (!validateSshPubkey(env.SSH_PUBKEY)) {
    row('required', 'SSH_PUBKEY (variable)', 'fail', 'does not look like a valid ssh public key',
        `Expected line shape: ssh-ed25519 <base64-body> [comment]. Re-set with the contents of <key>.pub.`);
    return;
  }

  // Parse the private key in a temp dir, derive the pub, compare bodies.
  const dir = mkdtempSync(join(tmpdir(), 'preflight-ssh-'));
  const keyPath = join(dir, 'id_ed25519');
  try {
    writeFileSync(keyPath, env.SSH_PRIVATE_KEY.endsWith('\n') ? env.SSH_PRIVATE_KEY : env.SSH_PRIVATE_KEY + '\n', { mode: 0o600 });
    const r = spawnSync('ssh-keygen', ['-y', '-P', '', '-f', keyPath], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) {
      const stderr = (r.stderr || '').trim();
      let detail = 'ssh-keygen failed to parse private key';
      let remedy = `Re-export the key from your local shell, NOT a Windows GUI editor. Check for CRLF / encrypted (passphrase) keys.`;
      if (/passphrase/i.test(stderr)) {
        detail = 'private key is encrypted with a passphrase';
        remedy = `Strip the passphrase: ssh-keygen -p -f <key> -P '<old>' -N '' then re-set the secret.`;
      } else if (env.SSH_PRIVATE_KEY.includes('\r')) {
        detail = 'private key contains CRLF line endings';
      } else if (!/^-----BEGIN/.test(env.SSH_PRIVATE_KEY)) {
        detail = 'first line is not a BEGIN marker — secret is truncated or wrong format';
      }
      row('required', 'SSH_PRIVATE_KEY', 'fail', detail, remedy);
      return;
    }
    const derivedBody = r.stdout.trim().split(/\s+/)[1] || '';
    const configuredBody = env.SSH_PUBKEY.trim().split(/\s+/)[1] || '';
    if (derivedBody !== configuredBody) {
      row('required', 'SSH_PRIVATE_KEY', 'fail',
          'private key does NOT correspond to SSH_PUBKEY',
          `Either update SSH_PRIVATE_KEY to the private half of SSH_PUBKEY, or replace SSH_PUBKEY with the public half of SSH_PRIVATE_KEY.`);
      return;
    }
    row('required', 'SSH_PRIVATE_KEY', 'pass', 'parses cleanly; matches SSH_PUBKEY');
    row('required', 'SSH_PUBKEY (variable)', 'pass', 'matches SSH_PRIVATE_KEY');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkCaddyEmail() {
  if (!env.CADDY_EMAIL) {
    row('required', 'CADDY_EMAIL (variable)', 'fail', 'not set',
        `gh variable set CADDY_EMAIL -b 'ops@example.com' (Let's Encrypt contact)`);
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.CADDY_EMAIL)) {
    row('required', 'CADDY_EMAIL (variable)', 'fail', `value "${env.CADDY_EMAIL}" doesn't look like an email`,
        `Set to a real address — LE rejects placeholders.`);
    return;
  }
  row('required', 'CADDY_EMAIL (variable)', 'pass', env.CADDY_EMAIL);
}

async function checkGhcrToken() {
  if (!env.GHCR_PULL_TOKEN) {
    row('required', 'GHCR_PULL_TOKEN', 'fail', 'not set',
        `Mint a classic PAT with read:packages ONLY at github.com/settings/tokens, then: gh secret set GHCR_PULL_TOKEN -b 'ghp_...'`);
    return;
  }
  // Probe ghcr.io for a pull token on this repo's image. A 200 with a `token`
  // field confirms read:packages on this repo (or any if the token is account-wide).
  if (!GH_OWNER || !GH_REPO) {
    row('required', 'GHCR_PULL_TOKEN', 'pass', '(format check only; owner/repo not resolvable)');
    return;
  }
  try {
    const scope = `repository:${GH_OWNER.toLowerCase()}/${GH_REPO.toLowerCase()}:pull`;
    const url = `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Basic ${Buffer.from(`${GH_OWNER}:${env.GHCR_PULL_TOKEN}`).toString('base64')}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      row('required', 'GHCR_PULL_TOKEN', 'fail', `ghcr.io returned ${r.status}`,
          `Token may lack read:packages, or be expired. Re-mint a classic PAT with read:packages.`);
      return;
    }
    const body = await r.json().catch(() => ({}));
    if (!body.token) {
      row('required', 'GHCR_PULL_TOKEN', 'fail', `ghcr.io returned ok but no pull token`,
          `Token may lack read:packages, or be expired. Re-mint a classic PAT with read:packages.`);
      return;
    }
    row('required', 'GHCR_PULL_TOKEN', 'pass', `pull token granted for ${GH_OWNER}/${GH_REPO}`);

    // Second probe: does the :latest manifest actually exist + is it pullable
    // with this token? The token endpoint succeeds even when no images have
    // been pushed yet -- which is how the operator hit "unauthorized" at
    // compose pull 90s into a deploy. Probing the manifest catches that
    // failure mode in 60s in preflight.
    try {
      const manifestUrl = `https://ghcr.io/v2/${GH_OWNER.toLowerCase()}/${GH_REPO.toLowerCase()}/manifests/latest`;
      const m = await fetch(manifestUrl, {
        headers: {
          'Authorization': `Bearer ${body.token}`,
          // Accept both v2 schema and OCI index so we don't 404 on multi-arch
          // images published by buildx.
          'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (m.ok) {
        row('required', 'GHCR :latest manifest', 'pass', `image is pullable from the droplet`);
      } else if (m.status === 404) {
        row('required', 'GHCR :latest manifest', 'fail',
            `ghcr.io/${GH_OWNER.toLowerCase()}/${GH_REPO.toLowerCase()}:latest not found (404)`,
            `Run docker-build.yml on main at least once: Actions → "Build & Push Docker Image" → Run workflow on branch=main. Wait ~3-5 min. Then re-run /preflight.`);
      } else if (m.status === 401 || m.status === 403) {
        row('required', 'GHCR :latest manifest', 'fail',
            `:latest exists but this token cannot pull (${m.status} -- private package + token lacks access)`,
            `Easy fix: make the package public at https://github.com/${GH_OWNER}/${GH_REPO}/pkgs/container/${GH_REPO.toLowerCase()} → Package settings → Danger zone → Change visibility → Public. (Acceptable for staging; image carries no secrets.) Or grant the token owner read access via the package's "Manage Actions access".`);
      } else {
        row('required', 'GHCR :latest manifest', 'fail', `ghcr.io manifest probe returned ${m.status}`,
            `Unexpected status; check network and ghcr.io status, then re-run.`);
      }
    } catch (e) {
      row('required', 'GHCR :latest manifest', 'fail', `manifest probe failed: ${truncate(e.message)}`,
          `Network issue. Re-run after confirming connectivity.`);
    }
  } catch (e) {
    row('required', 'GHCR_PULL_TOKEN', 'fail', `probe failed: ${truncate(e.message)}`,
        `Network or token issue. Re-mint if you're sure connectivity is fine.`);
  }
}

function checkBackupAge() {
  // recipient
  if (!env.BACKUP_AGE_RECIPIENT) {
    row(IS_PROD ? 'required' : 'prod-only', 'BACKUP_AGE_RECIPIENT',
        IS_PROD ? 'fail' : 'skip',
        IS_PROD ? 'not set (required for prod)' : 'not set; staging backups will be disabled',
        IS_PROD ? `Generate with: age-keygen -o /tmp/age-key. Public line ('age1...') → gh secret set BACKUP_AGE_RECIPIENT -b 'age1...'` : undefined);
  } else if (!/^age1[a-z0-9]+$/.test(env.BACKUP_AGE_RECIPIENT.trim())) {
    row(IS_PROD ? 'required' : 'prod-only', 'BACKUP_AGE_RECIPIENT', 'fail',
        `value doesn't look like an age recipient (expected age1...)`,
        `Re-export the public-key line from age-keygen output.`);
  } else {
    row(IS_PROD ? 'required' : 'prod-only', 'BACKUP_AGE_RECIPIENT', 'pass', 'valid age recipient');
  }

  // identity
  if (!env.BACKUP_AGE_IDENTITY) {
    row(IS_PROD ? 'required' : 'prod-only', 'BACKUP_AGE_IDENTITY',
        IS_PROD ? 'fail' : 'skip',
        IS_PROD ? 'not set (required for prod restores)' : 'not set; restore workflow will not work for this env',
        IS_PROD ? `From the age-keygen output, paste the 'AGE-SECRET-KEY-1...' line: gh secret set BACKUP_AGE_IDENTITY -b 'AGE-SECRET-KEY-1...'` : undefined);
  } else if (!/^AGE-SECRET-KEY-1/.test(env.BACKUP_AGE_IDENTITY.trim())) {
    row(IS_PROD ? 'required' : 'prod-only', 'BACKUP_AGE_IDENTITY', 'fail',
        `value doesn't look like an age identity (expected AGE-SECRET-KEY-1...)`,
        `Re-export the secret-key line from age-keygen output.`);
  } else {
    row(IS_PROD ? 'required' : 'prod-only', 'BACKUP_AGE_IDENTITY', 'pass', 'valid age identity');
  }
}

function checkRcloneConfig() {
  if (!env.RCLONE_CONFIG) {
    row(IS_PROD ? 'required' : 'prod-only', 'RCLONE_CONFIG',
        IS_PROD ? 'fail' : 'skip',
        IS_PROD ? 'not set (required for prod off-host backups)' : 'not set; staging backups will be disabled',
        IS_PROD ? `Run bootstrap-secrets.yml (the easy path) OR build rclone.conf manually with DO Spaces keys and: gh secret set RCLONE_CONFIG < rclone.conf` : undefined);
    return;
  }
  // Minimal sanity check: rclone INI must have at least a [section] header.
  if (!/^\s*\[[^\]]+\]/m.test(env.RCLONE_CONFIG)) {
    row(IS_PROD ? 'required' : 'prod-only', 'RCLONE_CONFIG', 'fail',
        'does not contain an [<remote>] section header',
        `rclone.conf must start with e.g. [spaces]\\ntype = s3\\n... — re-export with 'rclone config show'.`);
    return;
  }
  row(IS_PROD ? 'required' : 'prod-only', 'RCLONE_CONFIG', 'pass', 'INI format OK');
}

function checkSnapshot() {
  // Snapshot variable is per-region. Default region is fra1; we surface that
  // one. Other regions are informational only -- the deploy will fall back to
  // stock Ubuntu if the matching variable is unset.
  const region = 'fra1';
  const varName = `DO_BASE_SNAPSHOT_ID_${region.toUpperCase()}`;
  const v = process.env[varName] || '';
  if (v) {
    row('optional', `${varName} (variable)`, 'pass', `snapshot ${v} (~3-5 min faster deploys)`);
  } else {
    row('optional', `${varName} (variable)`, 'skip',
        `not set; deploys to ${region} use stock Ubuntu (~3-5 min slower). Run /build-snapshot once for big savings.`);
  }
}

function checkOptional() {
  checkSnapshot();
  if (env.SENTRY_DSN) {
    if (/^https?:\/\/[^@\s]+@[^\s]+/.test(env.SENTRY_DSN)) {
      row('optional', 'SENTRY_DSN (variable)', 'pass', 'looks like a Sentry DSN URL');
    } else {
      row('optional', 'SENTRY_DSN (variable)', 'fail', `value isn't a Sentry DSN URL (expected https://...@sentry.io/<id>)`);
    }
  } else {
    row('optional', 'SENTRY_DSN (variable)', 'skip', 'not set; error tracking disabled');
  }
  if (env.BETTER_UPTIME_API_KEY) {
    row('optional', 'BETTER_UPTIME_API_KEY', 'pass', 'set (format not probed)');
  } else {
    row('optional', 'BETTER_UPTIME_API_KEY', 'skip', 'not set; uptime monitor will not be registered');
  }
}

// ---------------------------------------------------------------------------
// Run + render
// ---------------------------------------------------------------------------

function truncate(s) {
  return String(s || '').replace(/\s+/g, ' ').slice(0, 200);
}

function paint(color, s) { return `${color}${s}${C.reset}`; }
function iconFor(status) {
  if (status === 'pass') return paint(C.green, ICON.pass);
  if (status === 'fail') return paint(C.red, ICON.fail);
  return paint(C.dim, ICON.skip);
}

console.log('');
console.log(paint(C.bold, `preflight: env=${ENV}${DOMAIN ? ` domain=${DOMAIN}` : ''}`));
console.log(paint(C.dim, `repo: ${GH_OWNER || '?'}/${GH_REPO || '?'}`));
console.log('');

// Run checks. Some are async; serialize to keep output ordering deterministic.
await checkDoToken();
await checkCfToken();
await checkGhToken();
checkSshPair();
checkCaddyEmail();
await checkGhcrToken();
checkBackupAge();
checkRcloneConfig();
checkOptional();

// Render grouped output.
function renderGroup(label, tierKey, headerColor) {
  const group = rows.filter(r => r.tier === tierKey);
  if (group.length === 0) return;
  console.log(paint(headerColor, label));
  for (const r of group) {
    const name = r.name.padEnd(34);
    const status = iconFor(r.status);
    console.log(`  ${status} ${name} ${r.detail}`);
    if (r.remedy && r.status === 'fail') {
      console.log(paint(C.dim, `      remedy: ${r.remedy}`));
    }
  }
  console.log('');
}

renderGroup(`Required for ${ENV}:`,                                'required',  C.cyan);
if (!IS_PROD) renderGroup('Required for prod (skipped on staging):', 'prod-only', C.dim);
else          renderGroup('Required for prod:',                       'prod-only', C.cyan);
renderGroup('Optional:', 'optional', C.dim);

// Final verdict.
const fails = rows.filter(r => r.status === 'fail' && (r.tier === 'required' || (IS_PROD && r.tier === 'prod-only')));
if (fails.length === 0) {
  console.log(paint(C.green, `${ICON.pass} preflight passed for ${ENV}.`));
  console.log(`  Next: gh workflow run deploy.yml -f env=${ENV} -f domain=${DOMAIN || '<your-domain>'} -f action=provision-and-deploy`);
  process.exit(0);
} else {
  console.log(paint(C.red, `${ICON.fail} preflight failed: ${fails.length} required item(s) need attention.`));
  console.log(`  Fix each "✗" row above, then re-run this workflow.`);
  process.exit(1);
}
