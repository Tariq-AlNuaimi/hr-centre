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
import { readState, writeState, mark, statePath, tagResource, emptyState } from './lib/state.mjs';
import { authSecret, dbPassword, auditToken, minioAccessKey, minioSecretKey, seedPassword, validateSshPubkey } from './lib/secrets.mjs';
import * as DO from './lib/do.mjs';
import * as CF from './lib/cloudflare.mjs';
import * as GH from './lib/github.mjs';
import * as P from './lib/portainer.mjs';
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
  values['caddy-email']       ||= process.env.CADDY_EMAIL || '';
  values['ssh-pubkey']        ||= process.env.SSH_PUBKEY || '';
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
    try { await DO.unassignAndReleaseIp(values['do-token'], state.droplet.reservedIp); ok('deploy', `reserved IP released`); } catch (e) { warn('deploy', `reserved IP release failed: ${e.message}`); }
  }
  if (state.droplet && state.droplet.id) {
    try { await DO.destroyDroplet(values['do-token'], state.droplet.id); ok('deploy', `droplet destroyed`); } catch (e) { warn('deploy', `droplet destroy failed: ${e.message}`); }
  }
  warn('deploy', `Spaces bucket "${SLUG}-backups-${ENV}" was NOT deleted (cost mitigation, paranoia). Delete via DO console if you really mean to.`);
  warn('deploy', `GitHub repo, secrets, and environment were NOT deleted (cost zero, paranoia). Delete via GH UI if needed.`);
  // Reset to fully empty state (preserving slug). Previously only droplet was
  // nulled, which left state.portainer.url pointing at the destroyed Droplet
  // and caused the next provision to "succeed" without actually deploying.
  const cleared = emptyState(ENV);
  cleared.slug = SLUG;
  await writeState(ENV, cleared);
  ok('deploy', `teardown complete for ${SLUG}-${ENV}; state reset.`);
  process.exit(0);
}

// -- Required inputs --------------------------------------------------------

const required = ['domain', 'caddy-email'];
if (!DRY) required.push('do-token', 'cf-token', 'gh-token', 'ssh-pubkey');
const missing = required.filter(k => !values[k]);
if (missing.length) bail('deploy', `missing required args: ${missing.map(m => `--${m}`).join(', ')}`);

if (values['ssh-pubkey'] && !validateSshPubkey(values['ssh-pubkey'])) {
  bail('deploy', `--ssh-pubkey doesn't look like a valid ssh public key (expected ssh-ed25519/ssh-rsa/ecdsa-sha2-*)`);
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
    const userData = await renderCloudInit({
      ssh_pubkey: values['ssh-pubkey'],
      caddy_email: CADDY_EMAIL,
      domain: DOMAIN,
    });
    let droplet = await DO.findDropletByTag(values['do-token'], TAG);
    if (!droplet) {
      droplet = await DO.createDroplet(values['do-token'], {
        name: DROPLET_NAME, region: REGION, size: SIZE,
        sshKeyId: sshKey.id, tags: [TAG, SLUG, ENV], userData,
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

// -- 3. Portainer install + admin claim -------------------------------------

if ((!state.portainer || !state.portainer.adminPassword) && !values['skip-stack']) {
  step('deploy', `${DRYP}installing Portainer on droplet`);
  if (!DRY) {
    // SSH to the Droplet's primary public IP, not the reserved IP. DO
    // reserved-IP routing can take 1-5 min to propagate from GH Actions
    // runner egress after assignment, so the reserved-IP path can stay
    // unreachable past our 5-min SSH wait. The primary IP works from boot.
    // The reserved IP is what end users hit via Cloudflare DNS; Portainer
    // admin URL still uses it because that access happens minutes later
    // from the operator's browser, after propagation has settled.
    const sshHost = state.droplet.ip || state.droplet.reservedIp;
    await P.waitForSsh(sshHost, 'root', values['ssh-key-path']);
    // Block until cloud-init's runcmd has finished installing Docker + Caddy.
    // sshd accepts root login as soon as DO injects the key (within seconds),
    // but cloud-init's apt-get docker install takes ~3-5 min. Without this,
    // installPortainer's `docker run` hits 'command not found'.
    await P.waitForCloudInit(sshHost, values['ssh-key-path']);
    await P.installPortainer(sshHost, values['ssh-key-path']);
    // Use the primary IP for in-script Portainer API calls (admin claim,
    // stack create, webhook). Reserved-IP routing can take 5-15 min to
    // propagate from GH Actions egress, longer than this script's runtime.
    // The primary IP is reachable from boot. publicUrl (below) is what we
    // report to the operator for browser access -- by then propagation has
    // settled.
    const portainerUrl = `https://${sshHost}:9443`;
    const portainerPublicUrl = `https://${state.droplet.reservedIp}:9443`;
    const adminPw = `Ops!${authSecret().slice(0, 20)}`;
    // Bypass self-signed cert for the install-window calls.
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      // Poll Portainer's /api/system/status until 200 instead of gambling on
      // a fixed sleep -- cold-start can take 20-30 sec (HIGH #1).
      await P.pollPortainerReady(portainerUrl);
      await P.initPortainerAdmin(portainerUrl, adminPw);
    } finally {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
    state = mark(state, 'portainer', { url: portainerUrl, publicUrl: portainerPublicUrl, adminPassword: adminPw, stackId: null, webhookUrl: null });
    await writeState(ENV, state);
    ok('deploy', `Portainer claimed at ${portainerUrl} (operator URL: ${portainerPublicUrl}; admin: ops-admin)`);
  } else {
    dim('deploy', `would install: Portainer CE on droplet :9443 + bootstrap admin`);
  }
} else if (values['skip-stack']) {
  warn('deploy', `--skip-stack: Portainer step skipped`);
} else {
  ok('deploy', `Portainer already installed (${state.portainer.url})`);
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
    const names = await GH.setManyRepoSecrets(values['gh-token'], GH_OWNER, GH_REPO, secrets);
    await GH.ensureEnvironment(values['gh-token'], GH_OWNER, GH_REPO, ENV);
    await GH.setManyEnvSecrets(values['gh-token'], GH_OWNER, GH_REPO, ENV, secrets);
    try { await GH.ensureMainRuleset(values['gh-token'], GH_OWNER, GH_REPO); } catch (e) { warn('deploy', `main ruleset apply failed (likely lacks admin scope): ${e.message}`); }
    state = mark(state, 'github', { repo: `${GH_OWNER}/${GH_REPO}`, secretsSet: names, envSet: [ENV] });
    await writeState(ENV, state);
    ok('deploy', `set ${names.length} GH secrets + env "${ENV}"`);
  } else {
    dim('deploy', `would set: ~12 GH secrets + ensure env "${ENV}" + main branch ruleset`);
  }
} else {
  warn('deploy', `--skip-secrets: GitHub step skipped`);
}

// -- 5. Portainer stack: create + webhook ----------------------------------

if (!values['skip-stack'] && state.portainer && (!state.portainer.stackId || !state.portainer.webhookUrl)) {
  step('deploy', `${DRYP}creating Portainer stack + webhook`);
  if (!DRY) {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const jwt = await P.getPortainerJwt(state.portainer.url, 'ops-admin', state.portainer.adminPassword);
      const endpointId = await P.getLocalEndpointId(state.portainer.url, jwt);
      const compose = await readFile(join(ROOT, 'docker-compose.prod.yml'), 'utf8');
      const envVars = stackEnvVars(state, {
        domain: DOMAIN,
        slug: SLUG,
        backupBucket: BACKUP_BUCKET,
        env: ENV,
        sentryDsn: values['sentry-dsn'] || process.env.SENTRY_DSN || '',
        ghOwner: GH_OWNER,
        ghRepo: GH_REPO,
      });
      let stackId = state.portainer.stackId;
      let webhookUrl = state.portainer.webhookUrl;
      if (!stackId) {
        const stack = await P.createComposeStack(state.portainer.url, jwt, endpointId, { name: `${SLUG}-${ENV}`, composeYaml: compose, envVars });
        stackId = stack.Id;
      }
      if (!webhookUrl) {
        // Webhook creation is a hard error (MEDIUM #6): without it /promote
        // and docker-build redeploys are silently broken.
        const wh = await P.createStackWebhook(state.portainer.url, jwt, stackId);
        if (!wh || !wh.WebhookID) {
          throw new Error('Portainer createStackWebhook returned no WebhookID; cannot wire docker-build webhook.');
        }
        webhookUrl = `${state.portainer.url}/api/stacks/webhooks/${wh.WebhookID}`;
      }
      state = mark(state, 'portainer', { ...state.portainer, stackId, webhookUrl });
      await writeState(ENV, state);
      // Push the webhook URL into GH secrets so docker-build.yml can trigger redeploys.
      await GH.setRepoSecret(values['gh-token'], GH_OWNER, GH_REPO, 'PORTAINER_WEBHOOK_URL', webhookUrl);
      ok('deploy', `stack ${stackId} + webhook -> set PORTAINER_WEBHOOK_URL`);
    } finally {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  } else {
    dim('deploy', `would create: Portainer stack + webhook + PORTAINER_WEBHOOK_URL gh secret`);
  }
}

// -- 6. Trigger first deploy + poll health ---------------------------------

if (!DRY && state.portainer && state.portainer.webhookUrl) {
  step('deploy', `triggering first deploy via Portainer webhook`);
  const sha = await GH.getLatestCommitSha(values['gh-token'], GH_OWNER, GH_REPO, 'main').catch(() => null);
  const tag = sha ? `sha-${sha.slice(0, 7)}` : 'latest';
  await P.triggerStackWebhook(state.portainer.webhookUrl, tag).catch(e => warn('deploy', `webhook trigger failed: ${e.message}`));
  state = mark(state, 'deployedSha', sha);
  await writeState(ENV, state);
  ok('deploy', `webhook fired (IMAGE_TAG=${tag}). Polling /api/health...`);

  // Phase A: direct-IP poll (90 sec). Self-signed cert is acceptable here
  // because Caddy may still be obtaining its LE cert; we just want to know
  // the app + Caddy chain is reachable independent of DNS propagation. If
  // this fails, that's a real infra failure.
  const phaseAUrl = `https://${state.droplet.ip}/api/health`;
  step('deploy', `phase A: direct-IP health poll @ ${phaseAUrl}`);
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let healthyA;
  try {
    healthyA = await pollHealth(phaseAUrl, 90_000);
  } finally {
    if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
  }
  if (!healthyA) {
    bail('deploy', `phase A health check failed (direct IP ${state.droplet.ip} did not return 200 in 90s). The app or Caddy reverse-proxy is not up; check Portainer logs.`);
  }
  ok('deploy', `phase A healthy: ${phaseAUrl}`);

  // Phase B: domain poll (90 sec). DNS may still be propagating from the CF
  // upsert seconds ago; soft-warn rather than fail the whole deploy.
  const phaseBUrl = `https://${DOMAIN}/api/health`;
  step('deploy', `phase B: domain health poll @ ${phaseBUrl}`);
  const healthyB = await pollHealth(phaseBUrl, 90_000);
  const healthy = healthyB;
  if (healthyB) {
    ok('deploy', `phase B healthy: ${phaseBUrl}`);
  } else {
    dim('deploy', `DNS not yet propagated; check: dig +short ${DOMAIN}`);
    warn('deploy', `phase B health check did not return 200 within 90s; deploy is successful from infra side (phase A green). DNS / LE cert will catch up shortly.`);
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
if (state.portainer) {
  console.log(`  Portainer:     ${state.portainer.url} (user: ops-admin / pw in .deploy-state.${ENV}.json)`);
}
console.log(`  State file:    ${statePath(ENV)}`);
console.log('');

// =========================================================================
// Helpers
// =========================================================================

async function renderCloudInit({ ssh_pubkey, caddy_email, domain }) {
  const tmpl = await readFile(join(ROOT, 'deploy/cloud-init.yml'), 'utf8');
  return tmpl
    .replaceAll('{{ssh_pubkey}}', ssh_pubkey)
    .replaceAll('{{caddy_email}}', caddy_email)
    .replaceAll('{{domain}}', domain);
}

function buildSecretMap(state, { domain, backupBucket, rcloneRemote, sentryDsn }) {
  // Everything CI + the workflows + restore-test need.
  const m = {
    AUTH_SECRET: authSecret(),
    AUDIT_PURGE_TOKEN: auditToken(),
    PROD_BASE_URL: `https://${domain}`,
    POSTGRES_PASSWORD: dbPassword(),
    BACKUP_BUCKET: backupBucket,
    RCLONE_REMOTE: rcloneRemote,
    // Generators below produce sound defaults; operators rotate as needed.
    MINIO_ROOT_USER: minioAccessKey(),
    MINIO_ROOT_PASSWORD: minioSecretKey(),
    MINIO_ACCESS_KEY: minioAccessKey(),
    MINIO_SECRET_KEY: minioSecretKey(),
    SEED_ADMIN_EMAIL: 'admin@example.com',
    SEED_ADMIN_PASSWORD: seedPassword(),
    // The following land via the explicit Portainer-webhook step:
    // PORTAINER_WEBHOOK_URL
    // The following are operator-supplied (skill prompts at end):
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

function stackEnvVars(state, { domain, slug, backupBucket, env, sentryDsn, ghOwner, ghRepo }) {
  // What docker-compose.prod.yml interpolates -- mirrors .env.example.
  // GHCR_IMAGE / IMAGE_TAG drive the `app` service's image reference. The
  // compose file uses `${GHCR_IMAGE}:${IMAGE_TAG}` so the fork's own image
  // gets pulled without requiring a /rebrand sweep of compose.
  const ghcrImage = ghOwner && ghRepo
    ? `ghcr.io/${ghOwner.toLowerCase()}/${ghRepo.toLowerCase()}`
    : 'ghcr.io/rihal-om/fullstack-next-template';
  const vars = {
    NEXT_PUBLIC_APP_NAME: slug,
    AUTH_SECRET: authSecret(),                  // re-mint per stack (Portainer-side copy)
    AUTH_URL: `https://${domain}`,              // production base URL for Auth.js
    NEXT_PUBLIC_APP_URL: `https://${domain}`,
    // Set Postgres user/db explicitly. Compose has `${POSTGRES_USER:-app}`
    // defaults, but those only fire when the var is UNSET; an empty string
    // passes through and breaks Postgres (falls back to default `postgres`
    // user, leaving the app's DATABASE_URL pointing at a non-existent user).
    POSTGRES_USER: 'app',
    POSTGRES_DB: 'app_db',
    POSTGRES_PASSWORD: dbPassword(),
    MINIO_ROOT_USER: minioAccessKey(),
    MINIO_ROOT_PASSWORD: minioSecretKey(),
    MINIO_ACCESS_KEY: minioAccessKey(),
    MINIO_SECRET_KEY: minioSecretKey(),
    MINIO_BUCKET: 'uploads',                    // matches compose default; explicit for consistency
    BACKUP_ENABLED: 'true',
    BACKUP_BUCKET: backupBucket,
    RCLONE_REMOTE: 'spaces',
    AUDIT_PURGE_TOKEN: auditToken(),
    GHCR_IMAGE: ghcrImage,
    // Use `latest` for first deploy. The docker-build workflow pushes both
    // `latest` and `sha-<short>` simultaneously on push to main, so `latest`
    // always points at the most recently-completed build. Pinning to a SHA
    // race-conditions against docker-build (deploy.yml dispatch can outrun
    // the build for that commit). Operators who want SHA-pinned prod set
    // IMAGE_TAG via Portainer stack env / a /rollback dispatch.
    IMAGE_TAG: 'latest',
    PROD_BASE_URL: `https://${domain}`,
    SEED_ADMIN_EMAIL: 'admin@example.com',
    SEED_ADMIN_PASSWORD: seedPassword(),
    SENTRY_ENVIRONMENT: env === 'prod' ? 'production' : env,
    // Sentry vars always present (empty string when not configured) so
    // re-deploys without a DSN don't inherit a stale one from prior runs.
    SENTRY_DSN: sentryDsn || '',
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn || '',
  };
  // (Sentry vars are unconditionally set above; the conditional block that
  // used to live here is gone -- empty string is the documented "disabled"
  // state for the Sentry SDK.)
  return vars;
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
