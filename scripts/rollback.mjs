#!/usr/bin/env node
// scripts/rollback.mjs
//
// Flip a Portainer stack's IMAGE_TAG env to a previous git SHA, then trigger
// the stack webhook. Re-uses the SHA-pinning pattern from T-04. Doesn't touch
// the DB -- pure image swap, ~30s to roll back.
//
// Usage:
//   npm run rollback -- --env prod --to sha-abc1234 --gh-token ghp_...
//   npm run rollback -- --env prod --list-recent --gh-token ghp_...
//   npm run rollback -- --env prod --to sha-abc1234 --dry-run

import { parseArgs } from 'node:util';
import { step, ok, warn, bail, info, dryPrefix } from './lib/log.mjs';
import { readState } from './lib/state.mjs';
import * as P from './lib/portainer.mjs';
import * as GH from './lib/github.mjs';

const { values } = parseArgs({
  options: {
    env: { type: 'string', default: 'prod' },
    to: { type: 'string' },
    'list-recent': { type: 'boolean', default: false },
    'gh-token': { type: 'string' },
    'gh-owner': { type: 'string' },
    'gh-repo': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
  strict: true,
});

const DRY = values['dry-run'];
const DRYP = dryPrefix(DRY);

const state = await readState(values.env);
if (!state.portainer || !state.portainer.webhookUrl) {
  bail('rollback', `no Portainer webhook recorded for env=${values.env}. Run /deploy --env ${values.env} first.`);
}

async function resolveRepo() {
  if (values['gh-owner'] && values['gh-repo']) return { owner: values['gh-owner'], repo: values['gh-repo'] };
  const { execSync } = await import('node:child_process');
  const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
  const m = url.match(/[:/]([^:/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!m) bail('rollback', `cannot derive GH repo`);
  return { owner: m[1], repo: m[2] };
}

if (values['list-recent']) {
  if (!values['gh-token']) bail('rollback', `--list-recent needs --gh-token`);
  const { owner, repo } = await resolveRepo();
  step('rollback', `last 10 builds on main`);
  const runs = await GH.listWorkflowRuns(values['gh-token'], owner, repo, 'docker-build.yml', 'main');
  for (const r of (runs.workflow_runs || []).slice(0, 10)) {
    const ok_ = r.conclusion === 'success' ? '✓' : (r.conclusion || '?');
    console.log(`  ${ok_}  sha-${r.head_sha.slice(0, 7)}  ${r.created_at}  ${r.display_title}`);
  }
  console.log(`\nUse: npm run rollback -- --env ${values.env} --to sha-<short> --yes`);
  process.exit(0);
}

if (!values.to) bail('rollback', `--to <sha-tag> is required (e.g. --to sha-abc1234)`);
if (!/^sha-[0-9a-f]{7,40}$/.test(values.to) && !/^[0-9a-f]{7,40}$/.test(values.to) && values.to !== 'latest') {
  bail('rollback', `--to "${values.to}" must look like "sha-abc1234" or "latest"`);
}
const tag = values.to.startsWith('sha-') || values.to === 'latest' ? values.to : `sha-${values.to.slice(0, 7)}`;

if (!values.yes && !DRY) {
  console.log(`\nAbout to flip ${state.slug}-${values.env} to IMAGE_TAG=${tag}.`);
  console.log(`Current deployed SHA: ${state.deployedSha || 'unknown'}`);
  console.log(`Re-run with --yes to proceed.\n`);
  process.exit(0);
}

step('rollback', `${DRYP}triggering ${values.env} webhook with IMAGE_TAG=${tag}`);
if (!DRY) {
  await P.triggerStackWebhook(state.portainer.webhookUrl, tag);
  ok('rollback', `webhook fired. Portainer is pulling the image and restarting the stack.`);
}

console.log(`\nVerify: curl -s https://${state.domain || '<env>'}/api/health`);
