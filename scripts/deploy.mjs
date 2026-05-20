#!/usr/bin/env node
// scripts/deploy.mjs
//
// One-shot provisioning + deploy for a fork. Goes from "fresh repo on
// GitHub" to "live HTTPS URL" without any manual clicks beyond providing
// the vendor API tokens.
//
// Usage:
//   npm run deploy -- --env staging --domain app.example.com \
//     --do-token ... --cf-token ... --gh-token ghp_... \
//     --ssh-pubkey "$(cat ~/.ssh/id_ed25519.pub)" \
//     --caddy-email you@example.com
//
//   npm run deploy -- --env staging --resume          # pick up after a partial run
//   npm run deploy -- --env staging --destroy         # tear everything down
//   npm run deploy -- --env staging --dry-run         # parse + plan only, no API calls
//
// See .claude/skills/deploy/SKILL.md.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { info, step, ok, warn, err, bail, dim, dryPrefix } from './lib/log.mjs';
import { readState, writeState, mark, statePath, tagResource, emptyState, discoverFromTags } from './lib/state.mjs';
import { authSecret, dbPassword, auditToken, minioAccessKey, minioSecretKey, seedPassword, validateSshPubkey } from './lib/secrets.mjs';
import * as DO from './lib/do.mjs';
import * as CF from './lib/cloudflare.mjs';
import * as GH from './lib/github.mjs';
import * as SSH from './lib/ssh-deploy.mjs';
import * as BU from './lib/better-uptime.mjs';

const ROOT = process.cwd();

// CI mode: workflows pass NON_INTERACTIVE=true (and CI=true). When set, the
// script must never prompt; all confirmation gates require an explicit --yes
// flag from the workflow caller, and credentials come from env vars only.
const CI = process.env.CI === 'true' || process.env.NON_INTERACTIVE === 'true';

// Make any unhandled error a hard exit-1 with a clear prefix (workflows must
// never hang on a stray rejection).
process.on('unhandledRejection', (e) => {
  err('deploy', `unhandled rejection: ${e && e.stack || e}`);
  process.exit(1);
});
process.on('uncaughtException', (e) => {
  err('deploy', `uncaught exception: ${e && e.stack || e}`);
  process.exit(1);
});

const { values } = parseArgs({
  options: {
    env: { type: 'string', default: 'staging' },
    slug: { type: 'string' },
    domain: { type: 'string' },
    'do-token': { type: 'string' },
    'cf-token': { type: 'string' },
    'gh-token': { type: 'string' },
    'gh-owner': { type: 'string' },
    'gh-repo': { type: 'string' },
    'ssh-pubkey': { type: 'string' },
    'ssh-key-path': { type: 'string', default: process.env.HOME ? `${process.env.HOME}/.ssh/id_ed25519` : '' },
    'caddy-email': { type: 'string' },
    'do-region': { type: 'string', default: DO.DEFAULTS.region },
    'do-size': { type: 'string', default: DO.DEFAULTS.size },
    'cf-zone': { type: 'string' },           // override auto-derived zone
    'rclone-remote': { type: 'string', default: 'spaces' },
    'backup-bucket': { type: 'string' },
    'skip-secrets': { type: 'boolean', default: false },
    'skip-stack': { type: 'boolean', default: false },
    'skip-provision': { type: 'boolean', default: false },
    'sentry-dsn': { type: 'string' },
    'better-uptime-key': { type: 'string' },
    'ghcr-pull-token': { type: 'string' },
    'backup-age-recipient': { type: 'string' },
    'rclone-config': { type: 'string' },
    'do-snapshot-id': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    destroy: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

// CI: pull credentials from env vars when not passed as flags. The workflows
// load these from GitHub Environment / repo secrets, so the operator never
// pastes a token into Claude chat.
if (CI) {
  values['do-token']         ||= process.env.DO_API_TOKEN || '';
  values['cf-token']         ||= process.env.CLOUDFLARE_API_TOKEN || '';
  values['gh-token']         ||= process.env.GITHUB_AUTOMATION_TOKEN || process.env.GITHUB_FALLBACK_TOKEN || process.env.GITHUB_TOKEN || '';
  values['better-uptime-key'] ||= process.env.BETTER_UPTIME_API_KEY || '';
  values['sentry-dsn']        ||= process.env.SENTRY_DSN || '';
  values['ghcr-pull-token']   ||= process.env.GHCR_PULL_TOKEN || '';
  values['backup-age-recipient'] ||= process.env.BACKUP_AGE_RECIPIENT || '';
  values['rclone-config']     ||= process.env.RCLONE_CONFIG || '';
  values['caddy-email']       ||= process.env.CADDY_EMAIL || '';
  values['ssh-pubkey']        ||= process.env.SSH_PUBKEY || '';
  // Snapshot ID is keyed by region (snapshots are region-locked on DO). The
  // workflow forwards every DO_BASE_SNAPSHOT_ID_* variable that exists; we
  // pick the one matching the target region. Falls back to empty -> stock
  // Ubuntu cloud-init path. See /build-snapshot.
  const region = (values['do-region'] || DO.DEFAULTS.region).toUpperCase().replace(/-/g, '_');
  values['do-snapshot-id'] ||= process.env[`DO_BASE_SNAPSHOT_ID_${region}`] || '';
}

// --skip-provision == --resume + --skip-stack=false. It's the "redeploy only"
// path used by the deploy.yml workflow's "redeploy" action: skip resource
// creation, just refresh the stack + trigger the webhook.
if (values['skip-provision']) {
  values.resume = true;
}

if (values.help) {
  console.log('See `head -25 scripts/deploy.mjs` for usage.');
  process.exit(0);
}

const DRY = values['dry-run'];
const ENV = values.env;
const DRYP = dryPrefix(DRY);

if (!/^[a-z][a-z0-9-]*$/.test(ENV)) bail('deploy', `--env "${ENV}" must be kebab-case (e.g. staging, prod)`);

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const SLUG = values.slug || pkg.name;
if (!/^[a-z][a-z0-9-]*$/.test(SLUG)) bail('deploy', `slug "${SLUG}" must be kebab-case. Run /rebrand first or pass --slug.`);

let state = await readState(ENV);
if (state.slug && state.slug !== SLUG) {
  warn('deploy', `state file slug "${state.slug}" != current slug "${SLUG}". Continuing with the current slug.`);
}
state = mark(state, 'slug', SLUG);

// -- Destroy path -----------------------------------------------------------

if (values.destroy) {
  if (!values.yes) bail('deploy', `--destroy requires --yes to confirm.`);
  if (DRY) { info('deploy', `${DRYP}would destroy: ${JSON.stringify(state, null, 2)}`); process.exit(0); }
  step('deploy', `tearing down ${SLUG}-${ENV}`);
  // Tag-discovery fallback. If the state file is empty (prior destroy reset
  // it, or a prior smoke crashed before state was persisted), the resource
  // pointers below are null and we'd skip teardown silently. discoverFromTags
  // queries DO for any droplet+IP carrying the vibe-managed=<slug>-<env> tag
  // and merges those into state for this run. Surfaced as a real bug after
  // multiple smoke runs left a droplet orphaned -- destroy ran "clean" but
  // the droplet kept running.
  if (values['do-token']) {
    try {
      const discovered = await discoverFromTags(DO, values['do-token'], SLUG, ENV);
      if (discovered.droplet && (!state.droplet || !state.droplet.id)) {
        warn('deploy', `state was empty but tag-discovery found droplet ${discovered.droplet.id} @ ${discovered.droplet.ip} -- destroying it`);
        state.droplet = { ...discovered.droplet, reservedIp: discovered.reservedIp || null };
      } else if (discovered.droplet && state.droplet && discovered.droplet.id !== state.droplet.id) {
        warn('deploy', `state points at droplet ${state.droplet.id} but tag-discovery also found ${discovered.droplet.id}. Both will be destroyed.`);
        // Stash the extra droplet for an additional destroy pass below.
        state.extraDroplet = discovered.droplet;
      }
    } catch (e) {
      warn('deploy', `tag-discovery failed (non-fatal; falling back to state-only teardown): ${e.message}`);
    }
  }
  // Better Uptime monitor teardown (best-effort; key from flag or env).
  const buKey = values['better-uptime-key'] || process.env.BETTER_UPTIME_API_KEY;
  if (state.betterUptimeMonitorId && buKey) {
    try { await BU.deleteMonitor({ apiKey: buKey, id: state.betterUptimeMonitorId }); ok('deploy', `uptime monitor ${state.betterUptimeMonitorId} deleted`); }
    catch (e) { warn('deploy', `uptime monitor delete failed: ${e.message}`); }
  } else if (state.betterUptimeMonitorId && !buKey) {
    warn('deploy', `state has betterUptimeMonitorId=${state.betterUptimeMonitorId} but BETTER_UPTIME_API_KEY unset; monitor NOT deleted. Delete manually or rerun --destroy with --better-uptime-key.`);
  }
  if (state.cloudflare && state.cloudflare.recordId) {
    try { await CF.deleteRecord(values['cf-token'], state.cloudflare.zoneId, state.cloudflare.recordId); ok('deploy', `CF record deleted`); } catch (e) { warn('deploy', `CF delete failed: ${e.message}`); }
  }
  if (state.droplet && state.droplet.reservedIp) {
    try {
      await DO.unassignAndReleaseIp(values['do-token'], state.droplet.reservedIp);
      ok('deploy', `reserved IP ${state.droplet.reservedIp} released`);
    } catch (e) {
      warn('deploy', `RESERVED IP RELEASE FAILED: ${e.message}`);
      warn('deploy', `MANUAL CLEANUP REQUIRED: visit DO Console → Networking → Reserved IPs, find ${state.droplet.reservedIp}, click ... → Delete.`);
      warn('deploy', `Idle reserved IPs cost $4/mo each.`);
    }
  }
  if (state.droplet && state.droplet.id) {
    try { await DO.destroyDroplet(values['do-token'], state.droplet.id); ok('deploy', `droplet ${state.droplet.id} destroyed`); } catch (e) { warn('deploy', `droplet ${state.droplet.id} destroy failed: ${e.message}`); }
  }
  // If tag-discovery found an additional droplet that wasn't in state (e.g.
  // a previous smoke crashed before persisting state), destroy it too.
  if (state.extraDroplet && state.extraDroplet.id) {
    try { await DO.destroyDroplet(values['do-token'], state.extraDroplet.id); ok('deploy', `extra (tag-discovered) droplet ${state.extraDroplet.id} destroyed`); } catch (e) { warn('deploy', `extra droplet destroy failed: ${e.message}`); }
  }
  // Nag the operator about any unattached reserved IPs left from prior
  // partial runs (failed destroys, manual creates, etc.). DO charges $4/mo
  // for every idle reserved IP. Best-effort: if listing fails, just skip.
  try {
    const orphans = await DO.listUnattachedReservedIps(values['do-token']);
    if (orphans.length > 0) {
      warn('deploy', `Found ${orphans.length} unattached reserved IP(s) on this DO account costing $${orphans.length * 4}/mo idle:`);
      for (const o of orphans) warn('deploy', `  - ${o.ip} (region: ${o.region && o.region.slug || '?'})`);
      warn('deploy', `Release each via DO Console → Networking → Reserved IPs → ... → Delete.`);
    } else {
      ok('deploy', `no orphaned reserved IPs found on this DO account.`);
    }
  } catch (e) {
    warn('deploy', `could not list reserved IPs to check for orphans: ${e.message}`);
  }
  warn('deploy', `Spaces bucket "${SLUG}-backups-${ENV}" was NOT deleted (cost mitigation, paranoia). Delete via DO console if you really mean to. ($5/mo idle.)`);
  warn('deploy', `GitHub repo, secrets, and environment were NOT deleted (cost zero, paranoia). Delete via GH UI if needed.`);
  // Reset to fully empty state (preserving slug) so a subsequent /deploy
  // does a clean provision rather than picking up dangling pointers to
  // destroyed resources.
  const cleared = emptyState(ENV);
  cleared.slug = SLUG;
  await writeState(ENV, cleared);
  ok('deploy', `teardown complete for ${SLUG}-${ENV}; state reset.`);
  process.exit(0);
}

// -- Required inputs --------------------------------------------------------

const required = ['domain', 'caddy-email'];
if (!DRY) required.push('do-token', 'cf-token', 'gh-token', 'ssh-pubkey', 'ghcr-pull-token');
// For prod, also require the backup secrets up front. For non-prod envs they
// remain optional (deploy proceeds with BACKUP_ENABLED=false; see below).
if (!DRY && ENV === 'prod') required.push('backup-age-recipient', 'rclone-config');
const missing = required.filter(k => !values[k]);
if (missing.length) {
  const hint = missing.includes('ghcr-pull-token')
    ? ` Run \`gh workflow run preflight.yml -f env=${ENV}\` first to validate every required secret in ~60s.`
    : '';
  bail('deploy', `missing required args: ${missing.map(m => `--${m}`).join(', ')}.${hint}`);
}

if (values['ssh-pubkey'] && !validateSshPubkey(values['ssh-pubkey'])) {
  bail('deploy', `--ssh-pubkey doesn't look like a valid ssh public key (expected ssh-ed25519/ssh-rsa/ecdsa-sha2-*)`);
}

// Backups are required for prod (enforced above) and optional for everything
// else. When optional and absent, we write placeholder content into cloud-init
// and flip BACKUP_ENABLED=false so the backup sidecar no-ops. Lets staging come
// up in ~5 min without operators having to generate age keys + DO Spaces keys
// before they can test anything.
const BACKUPS_DISABLED = !DRY && ENV !== 'prod' && (!values['backup-age-recipient'] || !values['rclone-config']);
if (BACKUPS_DISABLED) {
  warn('deploy', `BACKUP_AGE_RECIPIENT and/or RCLONE_CONFIG not set; staging will deploy with BACKUP_ENABLED=false. Set them before promoting to prod.`);
  values['backup-age-recipient'] = values['backup-age-recipient'] || '# disabled — staging deploy ran without BACKUP_AGE_RECIPIENT';
  values['rclone-config']        = values['rclone-config']        || '# disabled — staging deploy ran without RCLONE_CONFIG';
}

const DOMAIN = values.domain;
const CADDY_EMAIL = values['caddy-email'];
const REGION = values['do-region'];
const SIZE = values['do-size'];

// Derive GitHub repo from git remote if not passed.
async function resolveRepo() {
  if (values['gh-owner'] && values['gh-repo']) return { owner: values['gh-owner'], repo: values['gh-repo'] };
  try {
    const { execSync } = await import('node:child_process');
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const m = url.match(/[:/]([^:/]+)\/([^/.]+?)(?:\.git)?$/);
    if (m) return { owner: m[1], repo: m[2] };
  } catch (_) {}
  bail('deploy', `could not derive GH repo from git remote; pass --gh-owner + --gh-repo`);
}

const { owner: GH_OWNER, repo: GH_REPO } = await resolveRepo();
const TAG = `${SLUG}-${ENV}`;
const DROPLET_NAME = `${SLUG}-${ENV}`;
const BACKUP_BUCKET = values['backup-bucket'] || `${SLUG}-backups-${ENV}`;

// -- Cost preview + confirmation -------------------------------------------

if (CI && !values.yes && !values.destroy && !DRY) {
  bail('deploy', `CI mode requires --yes (workflows always pass it).`);
}

if (!values.resume && !values.yes && !DRY) {
  console.log('');
  console.log(`About to provision ${SLUG} / ${ENV}:`);
  console.log(`  DO Droplet:        ${DROPLET_NAME} (${SIZE}, ${REGION}) -- ~$12/mo`);
  console.log(`  DO Reserved IPv4:  $0 attached; $4/mo if detached`);
  console.log(`  DO Spaces bucket:  ${BACKUP_BUCKET} -- ~$5/mo`);
  console.log(`  CF DNS A record:   ${DOMAIN} -> reserved IP (free)`);
  console.log(`  GitHub secrets:    ~12 repo secrets + main branch ruleset (free)`);
  console.log(`  TOTAL:             ~$17/mo`);
  console.log('');
  console.log(`Re-run with --yes to proceed, or --dry-run to plan only.`);
  process.exit(0);
}

// -- Token validation -------------------------------------------------------

if (!DRY) {
  step('deploy', `validating tokens`);
  await DO.validateToken(values['do-token']).then(a => ok('deploy', `DO ok (${a.email || a.uuid})`));
  await CF.validateToken(values['cf-token']).then(t => ok('deploy', `CF ok (status=${t.status})`));
  await GH.validateToken(values['gh-token'], { owner: GH_OWNER, repo: GH_REPO }).then(u => ok('deploy', `GH ok (${u.login})`));
}

// -- 1. DO: SSH key + Droplet + reserved IP --------------------------------

if (!state.droplet || !state.droplet.id) {
  step('deploy', `${DRYP}provisioning droplet`);
  if (!DRY) {
    const sshKey = await DO.ensureSshKey(values['do-token'], `${TAG}-ops`, values['ssh-pubkey']);
    // Required-secret bails were lifted to the early-validation block above so
    // they fire at second 5, not minute 5 after ensureSshKey has already pushed
    // a key to DO. For non-prod envs without backup secrets, BACKUPS_DISABLED
    // routes placeholder content into the template; cloud-init's chown lines
    // are guarded with `|| true` so the no-op files don't trip runcmd.
    const SNAPSHOT_ID = values['do-snapshot-id'] || '';
    if (SNAPSHOT_ID) {
      ok('deploy', `using pre-baked snapshot ${SNAPSHOT_ID} (skips ~4 min of apt installs); see /build-snapshot`);
    } else {
      dim('deploy', `no DO_BASE_SNAPSHOT_ID_${REGION.toUpperCase().replace(/-/g, '_')} set; falling back to stock Ubuntu + full cloud-init (~4 min slower). Run /build-snapshot once per region for ~3-5 min savings on every deploy.`);
    }
    const userData = await renderCloudInit({
      ssh_pubkey: values['ssh-pubkey'],
      caddy_email: CADDY_EMAIL,
      domain: DOMAIN,
      gh_owner: GH_OWNER,
      ghcr_pull_token: values['ghcr-pull-token'],
      backup_age_recipient: values['backup-age-recipient'],
      rclone_config: values['rclone-config'],
      backup_bucket: BACKUP_BUCKET,
      slim: !!SNAPSHOT_ID,
    });
    let droplet = await DO.findDropletByTag(values['do-token'], TAG);
    if (!droplet) {
      droplet = await DO.createDroplet(values['do-token'], {
        name: DROPLET_NAME, region: REGION, size: SIZE,
        sshKeyId: sshKey.id, tags: [TAG, SLUG, ENV], userData,
        image: SNAPSHOT_ID || undefined,
      });
    }
    const { droplet: ready, ip } = await DO.waitForDropletActive(values['do-token'], droplet.id);
    const reserved = await DO.reserveAndAssignIp(values['do-token'], ready.id, REGION);
    state = mark(state, 'droplet', { id: ready.id, ip, reservedIp: reserved.ip, region: REGION, size: SIZE });
    await writeState(ENV, state);
    // Tag for tag-based discovery (ADR-004 backup source-of-truth). Best-effort.
    try {
      await tagResource(DO, values['do-token'], 'droplet', ready.id, SLUG, ENV);
      await tagResource(DO, values['do-token'], 'reserved_ip', reserved.ip, SLUG, ENV);
    } catch (e) {
      warn('deploy', `tagging resources for discovery failed (non-fatal): ${e.message}`);
    }
    ok('deploy', `droplet ${ready.id} active @ ${reserved.ip}`);
  } else {
    dim('deploy', `would create: droplet ${DROPLET_NAME} + reserved IPv4 + ssh key ${TAG}-ops`);
  }
} else if (!state.droplet.reservedIp) {
  // Partial state: droplet exists but no reserved IP; attach now (MEDIUM #4).
  step('deploy', `droplet ${state.droplet.id} exists but lacks reserved IP; attaching`);
  if (!DRY) {
    const reserved = await DO.reserveAndAssignIp(values['do-token'], state.droplet.id, REGION);
    state = mark(state, 'droplet', { ...state.droplet, reservedIp: reserved.ip });
    await writeState(ENV, state);
    try {
      await tagResource(DO, values['do-token'], 'reserved_ip', reserved.ip, SLUG, ENV);
    } catch (e) {
      warn('deploy', `tagging reserved_ip for discovery failed (non-fatal): ${e.message}`);
    }
    ok('deploy', `reserved IP ${reserved.ip} attached`);
  } else {
    dim('deploy', `would attach: reserved IPv4 to droplet ${state.droplet.id}`);
  }
} else {
  ok('deploy', `droplet ${state.droplet.id} already provisioned (${state.droplet.reservedIp})`);
}

// -- 2. CF: A record --------------------------------------------------------

if (!state.cloudflare || !state.cloudflare.recordId) {
  step('deploy', `${DRYP}upserting Cloudflare A record`);
  if (!DRY) {
    const zoneName = values['cf-zone'] || CF.rootDomain(DOMAIN);
    const zone = await CF.findZoneByName(values['cf-token'], zoneName);
    if (!zone) bail('deploy', `CF zone "${zoneName}" not found on this account. Pass --cf-zone if the domain uses an apex shorter than 2 labels.`);
    const rec = await CF.upsertARecord(values['cf-token'], zone.id, { name: DOMAIN, ip: state.droplet.reservedIp });
    state = mark(state, 'cloudflare', { zoneId: zone.id, recordId: rec.id, name: rec.name });
    await writeState(ENV, state);
    ok('deploy', `CF A ${DOMAIN} -> ${state.droplet.reservedIp}`);
  } else {
    dim('deploy', `would upsert: CF A ${DOMAIN} -> <reserved-ip>`);
  }
} else {
  ok('deploy', `CF A record already exists (${state.cloudflare.name})`);
}

// -- 3. SSH + cloud-init wait -----------------------------------------------
//
// Just ensure SSH is up and cloud-init has finished its runcmd (Docker +
// Caddy install). The actual stack deploy happens in section 5 below;
// section 3 only blocks until the host is ready to receive a deploy.

if (!values['skip-stack']) {
  step('deploy', `${DRYP}waiting for SSH + cloud-init on droplet`);
  if (!DRY) {
    // SSH to the Droplet's primary public IP, not the reserved IP. DO
    // reserved-IP routing can take 1-5 min to propagate from GH Actions
    // runner egress after assignment, so the reserved-IP path can stay
    // unreachable past our 5-min SSH wait. The primary IP works from boot.
    // The reserved IP is what end users hit via Cloudflare DNS.
    const sshHost = state.droplet.ip || state.droplet.reservedIp;
    await SSH.waitForSsh(sshHost, 'root', values['ssh-key-path']);
    // Block until cloud-init's runcmd has finished installing Docker + Caddy.
    // sshd accepts root login as soon as DO injects the key (within seconds),
    // but cloud-init's apt-get docker install takes ~3-5 min. Without this,
    // the deploy step below hits "docker: command not found".
    await SSH.waitForCloudInit(sshHost, values['ssh-key-path']);
    ok('deploy', `host ${sshHost} ready for deploy`);
  } else {
    dim('deploy', `would wait: ssh + cloud-init on droplet`);
  }
}

// -- 3b. Generate (or load) shared secrets ---------------------------------
//
// Every dynamic secret (AUTH_SECRET, POSTGRES_PASSWORD, MINIO creds,
// AUDIT_PURGE_TOKEN, SEED_ADMIN_PASSWORD) is consumed by BOTH the GH-secrets
// set (section 4) AND the host /opt/<slug>/.env file (section 5). The
// generators in lib/secrets.mjs return fresh randoms on every call -- if we
// call them in each map builder, the two maps DIVERGE: GH-secret value !=
// host-.env value. That breaks audit-retention.yml (token mismatch), confuses
// seed-password retrieval, etc. (Smoke surfaced this when SEED_ADMIN_PASSWORD
// stored as a GH secret didn't match what the seed script used to create the
// admin user.)
//
// Fix: generate once, persist to state.generatedSecrets, reuse on subsequent
// /deploy runs (idempotent -- re-run won't rotate the DB password out from
// under the running container). buildSecretMap + stackEnvVars both consume
// this same object.
if (!DRY && !state.generatedSecrets) {
  step('deploy', `generating shared secrets (AUTH_SECRET, POSTGRES_PASSWORD, MinIO, audit, seed)`);
  const generated = {
    AUTH_SECRET: authSecret(),
    AUDIT_PURGE_TOKEN: auditToken(),
    POSTGRES_PASSWORD: dbPassword(),
    MINIO_ROOT_USER: minioAccessKey(),
    MINIO_ROOT_PASSWORD: minioSecretKey(),
    SEED_ADMIN_PASSWORD: seedPassword(),
  };
  state = mark(state, 'generatedSecrets', generated);
  await writeState(ENV, state);
} else if (!DRY && state.generatedSecrets) {
  dim('deploy', `reusing existing generatedSecrets from state (idempotent re-run)`);
}

// -- 4. GitHub: secrets + ruleset ------------------------------------------

if (!values['skip-secrets']) {
  step('deploy', `${DRYP}setting GitHub repo secrets + ruleset`);
  if (!DRY) {
    const secrets = buildSecretMap(state, {
      domain: DOMAIN,
      backupBucket: BACKUP_BUCKET,
      rcloneRemote: values['rclone-remote'],
      sentryDsn: values['sentry-dsn'] || process.env.SENTRY_DSN || '',
    });
    // Parallelize the env-ensure with the repo-secrets PUT: the env-create
    // endpoint is independent of the repo-secrets endpoint, and both complete
    // in 1-2s normally. Then run the env-secrets after both are done.
    const [names] = await Promise.all([
      GH.setManyRepoSecrets(values['gh-token'], GH_OWNER, GH_REPO, secrets),
      GH.ensureEnvironment(values['gh-token'], GH_OWNER, GH_REPO, ENV),
    ]);
    await GH.setManyEnvSecrets(values['gh-token'], GH_OWNER, GH_REPO, ENV, secrets);
    // Branch protection ruleset: idempotent server-side but each call costs
    // ~3-5s. After the first successful apply we skip it on every subsequent
    // /deploy. Operators who want to re-apply (e.g. after editing the rule
    // structure in lib/github.mjs) can delete state.github.rulesetApplied or
    // run /deploy with --force-ruleset (not implemented yet -- TODO if needed).
    if (!state.github || !state.github.rulesetApplied) {
      try {
        await GH.ensureMainRuleset(values['gh-token'], GH_OWNER, GH_REPO);
        state = mark(state, 'github', { ...(state.github || {}), repo: `${GH_OWNER}/${GH_REPO}`, secretsSet: names, envSet: [ENV], rulesetApplied: true });
      } catch (e) {
        warn('deploy', `main ruleset apply failed (likely lacks admin scope): ${e.message}`);
        state = mark(state, 'github', { ...(state.github || {}), repo: `${GH_OWNER}/${GH_REPO}`, secretsSet: names, envSet: [ENV] });
      }
    } else {
      dim('deploy', `main ruleset already applied on first deploy (state.github.rulesetApplied=true); skipping`);
      state = mark(state, 'github', { ...state.github, secretsSet: names, envSet: [ENV] });
    }
    await writeState(ENV, state);
    ok('deploy', `set ${names.length} GH secrets + env "${ENV}"`);
  } else {
    dim('deploy', `would set: ~12 GH secrets + ensure env "${ENV}" + main branch ruleset`);
  }
} else {
  warn('deploy', `--skip-secrets: GitHub step skipped`);
}

// -- 5. SSH deploy: write compose + .env on droplet, docker compose up -d --

if (!values['skip-stack']) {
  step('deploy', `${DRYP}deploying docker compose stack via ssh`);
  if (!DRY) {
    const sshHost = state.droplet.ip || state.droplet.reservedIp;
    const sha = await GH.getLatestCommitSha(values['gh-token'], GH_OWNER, GH_REPO, 'main').catch(() => null);
    // First deploy uses :latest. docker-build.yml publishes :latest and
    // :sha-<short> simultaneously on every main push, so :latest always
    // points at the most-recently-completed build. SHA-pinning here
    // introduced a tag-format/visibility dependency on docker/metadata-action's
    // exact output and on GHCR auth scope -- both of which can 404 silently.
    // After this first deploy lands, docker-build.yml's own SSH-redeploy
    // step flips IMAGE_TAG to :sha-<short> on every subsequent push, so
    // SHA-pinning converges within ~5 min without operator action.
    // /promote + /rollback always pass explicit SHA tags via redeployStack,
    // so the prod SHA-pinning story is unchanged.
    const initialTag = 'latest';
    const compose = await readFile(join(ROOT, 'docker-compose.prod.yml'), 'utf8');
    // Aux files bind-mounted by compose at runtime. The backup service mounts
    // ./deploy:/scripts:ro and its entrypoint is /scripts/backup-entrypoint.sh
    // -- without these on the host the container crash-loops with
    // "can't open '/scripts/backup-entrypoint.sh': No such file or directory".
    const [backupSh, backupEntrypoint] = await Promise.all([
      readFile(join(ROOT, 'deploy/backup.sh'), 'utf8'),
      readFile(join(ROOT, 'deploy/backup-entrypoint.sh'), 'utf8'),
    ]);
    const envVars = stackEnvVars(state, {
      domain: DOMAIN,
      slug: SLUG,
      backupBucket: BACKUP_BUCKET,
      env: ENV,
      sentryDsn: values['sentry-dsn'] || process.env.SENTRY_DSN || '',
      ghOwner: GH_OWNER,
      ghRepo: GH_REPO,
      imageTag: initialTag,
      backupsDisabled: BACKUPS_DISABLED,
    });
    await SSH.deployStack(sshHost, values['ssh-key-path'], {
      slug: SLUG,
      composeYaml: compose,
      envVars,
      aux: {
        'deploy/backup.sh': backupSh,
        'deploy/backup-entrypoint.sh': backupEntrypoint,
      },
    });
    state = mark(state, 'deployedSha', sha);
    await writeState(ENV, state);
    // Persist the host IP as a repo variable so docker-build.yml (on every
    // main push) can SSH in and redeploy without reading the state branch.
    // Only the staging host is published this way -- prod redeploys are
    // gated by /promote which reads state directly.
    if (ENV === 'staging') {
      try {
        await GH.setRepoVariable(values['gh-token'], GH_OWNER, GH_REPO, 'STAGING_HOST', sshHost);
        await GH.setRepoVariable(values['gh-token'], GH_OWNER, GH_REPO, 'STAGING_SLUG', SLUG);
        ok('deploy', `set STAGING_HOST=${sshHost}, STAGING_SLUG=${SLUG} (used by docker-build.yml)`);
      } catch (e) {
        warn('deploy', `setting STAGING_HOST repo variable failed (auto-redeploy on push will be skipped): ${e.message}`);
      }
    }
    ok('deploy', `stack deployed on ${sshHost} (IMAGE_TAG=${initialTag})`);
  } else {
    dim('deploy', `would deploy: docker compose stack via ssh + write STAGING_HOST gh variable`);
  }
}

// -- 6. Health check (Phase A: SSH, Phase B: domain HTTPS) ------------------

if (!DRY && !values['skip-stack']) {
  // Phase A: SSH into the Droplet and curl localhost:3000/api/health. Bypasses
  // Caddy + LE cert entirely so we prove the app container itself is up. The
  // direct-IP-via-HTTPS approach falls through to Caddy's default handler
  // (Caddyfile only matches the configured domain, not the bare IP) so it
  // doesn't actually test the app.
  step('deploy', `phase A: SSH health check on ${state.droplet.ip}`);
  const healthyA = await SSH.pollHealthViaSsh(state.droplet.ip, values['ssh-key-path'], 300_000);
  if (!healthyA) {
    // Auto-dump compose state inline so the operator doesn't have to dispatch
    // diagnose-host.yml separately on every Phase A failure. Wrap in try so a
    // diagnostic SSH error doesn't shadow the original timeout.
    warn('deploy', `phase A timed out; dumping compose ps + logs for diagnostics before bailing`);
    try {
      const cd = `cd '/opt/${SLUG}' && docker compose -f docker-compose.prod.yml --env-file .env`;
      const ps = await SSH.sshExec(state.droplet.ip, 'root', `${cd} ps`, { sshKeyPath: values['ssh-key-path'], timeoutMs: 30_000 });
      console.log('\n===== docker compose ps =====\n' + (ps.stdout || ps.stderr || '(empty)'));
      const logs = await SSH.sshExec(state.droplet.ip, 'root', `${cd} logs --tail=100 --no-color`, { sshKeyPath: values['ssh-key-path'], timeoutMs: 60_000 });
      console.log('\n===== docker compose logs --tail=100 =====\n' + (logs.stdout || logs.stderr || '(empty)'));
    } catch (diagErr) {
      warn('deploy', `diagnostic dump failed: ${diagErr.message}`);
    }
    bail('deploy', `phase A health check failed (app container did not respond 200 to /api/health within 300s). Logs above show the failure mode.`);
  }
  ok('deploy', `phase A healthy: app responding on ${state.droplet.ip}:3000`);

  // Phase B: domain poll (90 sec). DNS may still be propagating from the CF
  // upsert seconds ago; soft-warn rather than fail the whole deploy.
  const phaseBUrl = `https://${DOMAIN}/api/health`;
  step('deploy', `phase B: domain health poll @ ${phaseBUrl} (180s -- DNS + LE first cert)`);
  // 180s covers: DNS A-record propagation from CF egress (5-30s) + LE
  // HTTP-01 challenge round-trip (30-60s on cold start) + Caddy applying
  // the cert + first 200 response. Sub-90s was too tight for first deploy.
  let healthyB = await pollHealth(phaseBUrl, 180_000);
  if (!healthyB) {
    // Caddy can get stuck on LE acquisition backoff when initial cert
    // attempts fail (e.g. reserved IP wasn't routing during boot). Smoke
    // surfaced this: Phase B timed out, browser showed ERR_SSL_PROTOCOL_ERROR
    // until a manual `systemctl restart caddy` (+ removing acme/*/locks)
    // unblocked it. Automate that recovery: stop+restart+clear-locks via
    // SSH, then re-poll for 120s (LE issues a fresh cert in ~30s once
    // the routing is healthy).
    warn('deploy', `phase B did not return 200 in 180s; attempting Caddy auto-recovery`);
    try {
      await SSH.sshExec(state.droplet.ip, 'root',
        'systemctl stop caddy; rm -rf /var/lib/caddy/.local/share/caddy/acme/*/locks 2>/dev/null || true; systemctl start caddy',
        { sshKeyPath: values['ssh-key-path'], timeoutMs: 30_000 });
      step('deploy', `caddy restarted; clearing LE backoff and re-polling for 120s`);
      healthyB = await pollHealth(phaseBUrl, 120_000);
    } catch (e) {
      warn('deploy', `caddy auto-recovery failed: ${e.message}`);
    }
  }
  const healthy = healthyB;
  if (healthyB) {
    ok('deploy', `phase B healthy: ${phaseBUrl}`);
  } else if (ENV === 'prod') {
    // Prod: keep the soft-warn behavior. /promote polls separately; DNS / LE
    // propagation can legitimately exceed our 5-min budget on first prod
    // deploys to a new domain, and the prod URL is monitored externally
    // (Better Uptime) so a delayed first 200 doesn't deserve to fail the run.
    dim('deploy', `DNS / LE cert still not ready after auto-recovery. Check: dig +short ${DOMAIN} && curl -v https://${DOMAIN}`);
    warn('deploy', `phase B health check did not return 200 (infra side is up -- phase A green). Most common cause: DO reserved IP routing still propagating. Re-test in 5 min.`);
  }

  // Persist the domain so downstream ops (`/promote` polls `prod.domain`,
  // `/rollback` reads `state.domain`) have a real URL to hit. Both consumers
  // currently fall back to `<prod>` / `<env>` placeholders when missing,
  // silently masking the broken health verification.
  state = mark(state, 'domain', DOMAIN);
  await writeState(ENV, state);

  // For non-prod envs, treat Phase B failure as fatal. The operator is
  // iterating; a false-positive green deploy wastes the next 30-min loop.
  // Bailing here still persists state (domain + droplet IDs) so the next
  // run can use action=redeploy. (Moved after writeState for that reason.)
  if (!healthyB && ENV !== 'prod') {
    bail('deploy',
      `phase B health check failed: https://${DOMAIN}/api/health did not return 200 within 5 min ` +
      `(initial poll 180s + auto-recovery + re-poll 120s). ` +
      `Diagnose: \`dig +short ${DOMAIN}\` should return ${state.droplet.reservedIp}; ` +
      `\`curl -vI https://${DOMAIN}\` will surface cert / proxy issues. ` +
      `Then dispatch diagnose-host.yml with restart_caddy=true, OR re-run /deploy with action=redeploy.`);
  }

  // -- 7. Register Better Uptime monitor (per ADR-002) ----------------------
  if (healthy) {
    const buKey = values['better-uptime-key'] || process.env.BETTER_UPTIME_API_KEY;
    if (!buKey) {
      warn('deploy', `uptime monitor not registered; set BETTER_UPTIME_API_KEY (or pass --better-uptime-key) to enable.`);
    } else {
      const monitorUrl = `https://${DOMAIN}/api/health`;
      try {
        let id = state.betterUptimeMonitorId || await BU.getMonitorByUrl({ apiKey: buKey, url: monitorUrl });
        if (!id) {
          const created = await BU.createMonitor({ apiKey: buKey, url: monitorUrl, name: `${SLUG}-${ENV}` });
          id = created.id;
          ok('deploy', `better-uptime monitor ${id} created for ${monitorUrl}`);
        } else {
          ok('deploy', `better-uptime monitor ${id} already exists for ${monitorUrl}`);
        }
        if (id) {
          state = mark(state, 'betterUptimeMonitorId', id);
          await writeState(ENV, state);
        }
      } catch (e) {
        warn('deploy', `better-uptime registration failed: ${e.message}`);
      }
    }
  }
}

// -- Done -------------------------------------------------------------------

console.log('');
ok('deploy', `${DRYP}${SLUG}-${ENV} ready.`);
console.log(`  URL:           https://${DOMAIN}`);
console.log(`  Health:        https://${DOMAIN}/api/health`);
console.log(`  Host:          ${state.droplet ? state.droplet.reservedIp : '<unknown>'} (ssh root@${state.droplet ? state.droplet.ip : '<unknown>'})`);
console.log(`  Stack:         /opt/${SLUG}/ on host (docker compose ps to inspect)`);
console.log(`  State file:    ${statePath(ENV)}`);
console.log('');

// =========================================================================
// Helpers
// =========================================================================

async function renderCloudInit({ ssh_pubkey, caddy_email, domain, gh_owner, ghcr_pull_token, backup_age_recipient, rclone_config, backup_bucket, slim }) {
  let tmpl = await readFile(join(ROOT, 'deploy/cloud-init.yml'), 'utf8');
  if (slim) {
    // The droplet booted from a pre-baked snapshot (see /build-snapshot) that
    // already has docker-ce + caddy + GPG keys + apt repos installed. Strip
    // the apt-install runcmd lines so we don't waste ~4 min re-running them.
    // We KEEP: ufw rules, backup-dir create, chown/chmod on /opt/backup,
    // rclone mkdir, systemctl reload caddy. Those are config steps that
    // depend on the per-project secrets baked into write_files this run.
    tmpl = stripAptInstallRuncmd(tmpl);
  }
  // base64(github-username:pull-token) is the Docker config.json `auth` form.
  // Use the GH owner as the username (Docker doesn't care about exact value;
  // GH treats anything-non-empty-with-matching-token as a successful login).
  const ghcrAuthB64 = Buffer.from(`${gh_owner}:${ghcr_pull_token}`).toString('base64');
  // Cloud-init's `content: |` block is YAML block scalar -- every line must
  // be indented by the same amount as the first content line (here, 6
  // spaces -- 4 under `write_files:` and 2 more under `- path:`). Re-indent
  // the multi-line rclone INI to match before substituting.
  const indent = '      ';
  const indentedRclone = (rclone_config || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n');
  const trimmedRecipient = (backup_age_recipient || '').trim();
  return tmpl
    .replaceAll('{{ssh_pubkey}}', ssh_pubkey)
    .replaceAll('{{caddy_email}}', caddy_email)
    .replaceAll('{{domain}}', domain)
    .replaceAll('{{ghcr_auth_b64}}', ghcrAuthB64)
    .replaceAll('{{backup_age_recipient}}', trimmedRecipient)
    .replaceAll('{{rclone_config}}', indentedRclone)
    .replaceAll('{{backup_bucket}}', backup_bucket || '');
}

function buildSecretMap(state, { domain, backupBucket, rcloneRemote, sentryDsn }) {
  // Pulls dynamic values from state.generatedSecrets (generated once per env,
  // persisted to state). Ensures GH-secret values match the host /opt/<slug>/.env
  // values for the same env. See "section 3b" in main flow above.
  const gs = state.generatedSecrets || {};
  const m = {
    AUTH_SECRET: gs.AUTH_SECRET,
    AUDIT_PURGE_TOKEN: gs.AUDIT_PURGE_TOKEN,
    PROD_BASE_URL: `https://${domain}`,
    POSTGRES_PASSWORD: gs.POSTGRES_PASSWORD,
    BACKUP_BUCKET: backupBucket,
    RCLONE_REMOTE: rcloneRemote,
    // MinIO root credentials. compose substitutes ROOT_USER/ROOT_PASSWORD into
    // the app's MINIO_ACCESS_KEY/MINIO_SECRET_KEY at runtime, so the app and
    // MinIO server use the same credential pair.
    MINIO_ROOT_USER: gs.MINIO_ROOT_USER,
    MINIO_ROOT_PASSWORD: gs.MINIO_ROOT_PASSWORD,
    MINIO_ACCESS_KEY: gs.MINIO_ROOT_USER,
    MINIO_SECRET_KEY: gs.MINIO_ROOT_PASSWORD,
    SEED_ADMIN_EMAIL: 'admin@example.com',
    SEED_ADMIN_PASSWORD: gs.SEED_ADMIN_PASSWORD,
    // Operator-supplied secrets land via /first-fork or bootstrap-secrets.yml:
    // BACKUP_AGE_IDENTITY, RCLONE_CONFIG, SENTRY_AUTH_TOKEN, BETTER_UPTIME_API_KEY
  };
  // Sentry DSN is public-by-design (see ADR-002 + SECURITY.md §6) but we
  // still set it as a repo secret so the same value is used everywhere.
  if (sentryDsn) {
    m.SENTRY_DSN = sentryDsn;
    m.NEXT_PUBLIC_SENTRY_DSN = sentryDsn;
  }
  return m;
}

function stackEnvVars(state, { domain, slug, backupBucket, env, sentryDsn, ghOwner, ghRepo, imageTag, backupsDisabled }) {
  // What docker-compose.prod.yml interpolates -- mirrors .env.example.
  // GHCR_IMAGE / IMAGE_TAG drive the `app` service's image reference. The
  // compose file uses `${GHCR_IMAGE}:${IMAGE_TAG}` so the fork's own image
  // gets pulled without requiring a /rebrand sweep of compose.
  const ghcrImage = ghOwner && ghRepo
    ? `ghcr.io/${ghOwner.toLowerCase()}/${ghRepo.toLowerCase()}`
    : 'ghcr.io/rihal-om/fullstack-next-template';
  // Pull dynamic values from state.generatedSecrets so the host .env matches
  // the GH-secret values for the same env. See "section 3b" in main flow.
  const gs = state.generatedSecrets || {};
  const vars = {
    NEXT_PUBLIC_APP_NAME: slug,
    AUTH_SECRET: gs.AUTH_SECRET,
    AUTH_URL: `https://${domain}`,              // production base URL for Auth.js
    NEXT_PUBLIC_APP_URL: `https://${domain}`,
    // Set Postgres user/db explicitly. Compose has `${POSTGRES_USER:-app}`
    // defaults, but those only fire when the var is UNSET; an empty string
    // passes through and breaks Postgres (falls back to default `postgres`
    // user, leaving the app's DATABASE_URL pointing at a non-existent user).
    POSTGRES_USER: 'app',
    POSTGRES_DB: 'app_db',
    POSTGRES_PASSWORD: gs.POSTGRES_PASSWORD,
    MINIO_ROOT_USER: gs.MINIO_ROOT_USER,
    MINIO_ROOT_PASSWORD: gs.MINIO_ROOT_PASSWORD,
    MINIO_ACCESS_KEY: gs.MINIO_ROOT_USER,        // compose substitutes ROOT_USER here
    MINIO_SECRET_KEY: gs.MINIO_ROOT_PASSWORD,    // compose substitutes ROOT_PASSWORD here
    MINIO_BUCKET: 'uploads',                    // matches compose default; explicit for consistency
    // Flipped to 'false' when staging/dev deploys without BACKUP_AGE_RECIPIENT
    // or RCLONE_CONFIG. The backup sidecar no-ops when BACKUP_ENABLED=false;
    // cloud-init still writes placeholder /opt/backup/{recipient,rclone.conf}
    // so the chown lines have something to chown.
    BACKUP_ENABLED: backupsDisabled ? 'false' : 'true',
    BACKUP_BUCKET: backupBucket,
    RCLONE_REMOTE: 'spaces',
    AUDIT_PURGE_TOKEN: gs.AUDIT_PURGE_TOKEN,
    GHCR_IMAGE: ghcrImage,
    // SHA-pinned. The deploy script resolves the current main SHA before
    // calling stackEnvVars; docker-build.yml redeploys with the new SHA on
    // each push, and /promote / /rollback edit IMAGE_TAG in place via SSH.
    // Falling back to "latest" preserves the original first-deploy behavior
    // when the SHA lookup fails.
    IMAGE_TAG: imageTag || 'latest',
    PROD_BASE_URL: `https://${domain}`,
    SEED_ADMIN_EMAIL: 'admin@example.com',
    SEED_ADMIN_PASSWORD: gs.SEED_ADMIN_PASSWORD,
    SENTRY_ENVIRONMENT: env === 'prod' ? 'production' : env,
  };
  // Sentry DSN must be either a valid URL or absent -- lib/env.ts's zod
  // schema rejects empty string under .url().optional(). Only set the vars
  // when a real DSN is configured; absent = SDK no-ops.
  if (sentryDsn) {
    vars.SENTRY_DSN = sentryDsn;
    vars.NEXT_PUBLIC_SENTRY_DSN = sentryDsn;
  }
  return vars;
}

// Strip the Docker + Caddy apt-install lines from cloud-init.yml's runcmd.
// Called when the droplet boots from a pre-baked snapshot that already has
// those packages installed. Keeps the matcher narrow on purpose: only deletes
// runcmd entries we know are safe to skip, and keeps everything else (UFW
// rules, /opt/backup setup, rclone mkdir, caddy reload). If the template
// changes, eyeball the kept-vs-stripped split by running:
//   node -e "import('./scripts/deploy.mjs').then(...)"  # ad-hoc render
const SLIM_STRIP_PATTERNS = [
  /^\s*-\s*install -m 0755 -d \/etc\/apt\/keyrings\s*$/,
  /^\s*-\s*curl -fsSL https:\/\/download\.docker\.com\/linux\/ubuntu\/gpg/,
  /^\s*-\s*chmod a\+r \/etc\/apt\/keyrings\/docker\.asc\s*$/,
  /^\s*-\s*echo "deb \[arch=.* download\.docker\.com/,
  /^\s*-\s*DEBIAN_FRONTEND=noninteractive apt-get update -y\s*$/,
  /^\s*-\s*DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce/,
  /^\s*-\s*systemctl enable --now docker\s*$/,
  /^\s*-\s*usermod -aG docker ops\s*$/,
  /^\s*-\s*curl -1sLf 'https:\/\/dl\.cloudsmith\.io\/public\/caddy/,
  /^\s*-\s*DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold caddy\s*$/,
  /^\s*-\s*systemctl enable --now caddy\s*$/,
];
function stripAptInstallRuncmd(tmpl) {
  return tmpl.split('\n').filter(line => !SLIM_STRIP_PATTERNS.some(re => re.test(line))).join('\n');
}

async function pollHealth(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) return true;
    } catch (_) {}
    await new Promise(res => setTimeout(res, 5000));
  }
  return false;
}
