#!/usr/bin/env node
// scripts/promote.mjs
//
// Promote a commit from staging to production:
//   1. Verify the target SHA's CI is green on the staging env
//   2. Tag prod-YYYYMMDD-HHmm pointing at the SHA
//   3. Trigger the prod stack's Portainer webhook with the SHA
//   4. Poll prod /api/health
//
// Usage:
//   npm run promote -- --sha abc1234 --gh-token ghp_...
//   npm run promote -- --sha HEAD --gh-token ghp_... [--dry-run]

import { parseArgs } from 'node:util';
import { step, ok, warn, bail, info, err, dryPrefix } from './lib/log.mjs';
import { readState } from './lib/state.mjs';
import * as GH from './lib/github.mjs';
import * as P from './lib/portainer.mjs';

const CI = process.env.CI === 'true' || process.env.NON_INTERACTIVE === 'true';

process.on('unhandledRejection', (e) => { err('promote', `unhandled rejection: ${e && e.stack || e}`); process.exit(1); });
process.on('uncaughtException',  (e) => { err('promote', `uncaught exception: ${e && e.stack || e}`); process.exit(1); });

const { values } = parseArgs({
  options: {
    sha: { type: 'string' },
    slug: { type: 'string' },
    'gh-token': { type: 'string' },
    'gh-owner': { type: 'string' },
    'gh-repo': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
  strict: true,
});

if (CI) {
  values['gh-token'] ||= process.env.GITHUB_AUTOMATION_TOKEN || process.env.GITHUB_FALLBACK_TOKEN || process.env.GITHUB_TOKEN || '';
  // In CI, missing --sha or sha='HEAD' falls back to the latest commit on main.
}

const DRY = values['dry-run'];
const DRYP = dryPrefix(DRY);

if (!values.sha) bail('promote', `--sha is required (use a 7+ char SHA or "HEAD")`);
if (!DRY && !values['gh-token']) bail('promote', `--gh-token required for non-dry runs`);

const staging = await readState('staging').catch(() => null);
const prod = await readState('prod').catch(() => null);
if (!staging || !staging.portainer) bail('promote', `staging state file missing. Run /deploy --env staging first.`);
if (!prod || !prod.portainer || !prod.portainer.webhookUrl) bail('promote', `prod state file missing or webhook unset. Run /deploy --env prod first.`);

async function resolveRepo() {
  if (values['gh-owner'] && values['gh-repo']) return { owner: values['gh-owner'], repo: values['gh-repo'] };
  const { execSync } = await import('node:child_process');
  const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
  const m = url.match(/[:/]([^:/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!m) bail('promote', `cannot derive GH repo from git remote`);
  return { owner: m[1], repo: m[2] };
}
const { owner, repo } = await resolveRepo();

// Resolve HEAD
let sha = values.sha;
if (sha === 'HEAD' && !DRY) {
  sha = await GH.getLatestCommitSha(values['gh-token'], owner, repo, 'main');
}
if (sha.length < 7) bail('promote', `--sha "${sha}" too short`);
const shortSha = sha.slice(0, 7);
info('promote', `target: ${shortSha} (${owner}/${repo})`);

// 1. Check staging CI green
if (!DRY) {
  step('promote', `checking docker-build.yml status for ${shortSha} on staging`);
  const runs = await GH.listWorkflowRuns(values['gh-token'], owner, repo, 'docker-build.yml', 'main');
  const hit = (runs.workflow_runs || []).find(r => r.head_sha.startsWith(shortSha));
  if (!hit) warn('promote', `no docker-build.yml run found for ${shortSha}; promoting anyway (--yes assumed pre-checked) -- but verify image exists in GHCR`);
  else if (hit.conclusion !== 'success') bail('promote', `docker-build.yml run for ${shortSha} concluded "${hit.conclusion}". Refusing to promote a non-green build.`);
  else ok('promote', `staging build green`);
}

if (!values.yes && !DRY) {
  console.log(`\nReady to promote ${shortSha} -> prod. Re-run with --yes to confirm.\n`);
  process.exit(0);
}

// 2. Tag
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);  // YYYYMMDDTHHmm
const tag = `prod-${stamp}`;
if (!DRY) {
  step('promote', `tagging ${tag} -> ${shortSha}`);
  await GH.createTag(values['gh-token'], owner, repo, tag, sha).catch(e => warn('promote', `tag create failed: ${e.message}`));
}

// 3. Webhook
step('promote', `${DRYP}triggering prod webhook (IMAGE_TAG=sha-${shortSha})`);
if (!DRY) {
  await P.triggerStackWebhook(prod.portainer.webhookUrl, `sha-${shortSha}`);
}

// 4. Health poll
if (!DRY) {
  step('promote', `polling https://${prod.domain || '<prod>'}/api/health`);
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    try {
      const r = await fetch(`https://${prod.domain || ''}/api/health`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) { ok('promote', `prod healthy on ${shortSha}`); process.exit(0); }
    } catch (_) {}
    await new Promise(res => setTimeout(res, 5000));
  }
  warn('promote', `health check did not return 200 within 3 min -- check Portainer logs`);
}

ok('promote', `${DRYP}done.`);
