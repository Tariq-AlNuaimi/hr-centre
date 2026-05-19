#!/usr/bin/env node
// scripts/new-project.mjs
//
// One-prompt orchestrator: idea -> repo from template -> rebrand -> scaffold
// every proposed entity -> first deploy to staging -> live URL.
//
// This script is invoked by the /new-project skill. Claude reasons about the
// idea string, proposes (slug, name, entities), gets operator confirmation,
// THEN passes the structured plan to this script as a JSON file.
//
// Why JSON-on-disk instead of a long CLI: entity field specs get long, and
// JSON sidesteps shell quoting issues. The skill writes /tmp/new-project.json
// (or any path passed via --plan).
//
// Usage:
//   npm run new-project -- --plan /tmp/new-project.json --gh-token ghp_... \
//     --do-token ... --cf-token ... --ssh-pubkey "..." --caddy-email you@example.com
//
// Plan file shape:
//   {
//     "templateOwner": "tariq-alnuaimi",
//     "templateRepo":  "fullstack-vibe-template",
//     "owner":         "tariq-alnuaimi",
//     "slug":          "rihal-tasks",
//     "displayName":   "Rihal Tasks",
//     "description":   "Internal task tracker",
//     "domain":        "tasks.staging.rihal.com",
//     "entities": [
//       { "name": "Project", "fields": "name:string,code:string", "enums": null, "relations": null },
//       { "name": "Task", "fields": "title:string,description:text?", "enums": "status:TODO|IN_PROGRESS|DONE,priority:LOW|MED|HIGH", "relations": "project:Project,assignee:User?" }
//     ]
//   }

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync } from 'node:fs';
import { step, ok, warn, bail, info, err, dryPrefix } from './lib/log.mjs';
import * as GH from './lib/github.mjs';

const CI = process.env.CI === 'true' || process.env.NON_INTERACTIVE === 'true';

process.on('unhandledRejection', (e) => { err('new-project', `unhandled rejection: ${e && e.stack || e}`); process.exit(1); });
process.on('uncaughtException',  (e) => { err('new-project', `uncaught exception: ${e && e.stack || e}`); process.exit(1); });

const { values } = parseArgs({
  options: {
    plan: { type: 'string' },
    'gh-token': { type: 'string' },
    'do-token': { type: 'string' },
    'cf-token': { type: 'string' },
    'ssh-pubkey': { type: 'string' },
    'caddy-email': { type: 'string' },
    'work-dir': { type: 'string' },
    'skip-deploy': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
  strict: true,
});

const DRY = values['dry-run'];
const DRYP = dryPrefix(DRY);

if (CI) {
  values['gh-token']    ||= process.env.GITHUB_AUTOMATION_TOKEN || process.env.GITHUB_FALLBACK_TOKEN || process.env.GITHUB_TOKEN || '';
  values['do-token']    ||= process.env.DO_API_TOKEN || '';
  values['cf-token']    ||= process.env.CLOUDFLARE_API_TOKEN || '';
  values['ssh-pubkey']  ||= process.env.SSH_PUBKEY || '';
  values['caddy-email'] ||= process.env.CADDY_EMAIL || '';
}

// Bootstrap-secrets propagation: the GH REST API cannot READ existing secret
// values, only set them. So the only way to seed the new fork with the
// operator's account-wide credentials is to inject them here as env vars
// (passed by .github/workflows/new-project.yml from `${{ secrets.* }}`) and
// PUT them onto the fork. The list below is exhaustive -- adding a new
// secret to /first-fork SKILL.md means adding it here AND in the workflow.
const BOOTSTRAP_SECRETS = {
  DO_API_TOKEN:           process.env.DO_API_TOKEN || '',
  CLOUDFLARE_API_TOKEN:   process.env.CLOUDFLARE_API_TOKEN || '',
  BETTER_UPTIME_API_KEY:  process.env.BETTER_UPTIME_API_KEY || '',
  SENTRY_AUTH_TOKEN:      process.env.SENTRY_AUTH_TOKEN || '',
  SSH_PRIVATE_KEY:        process.env.SSH_PRIVATE_KEY || '',
  GH_AUTOMATION_TOKEN:    process.env.GH_AUTOMATION_TOKEN || process.env.GITHUB_AUTOMATION_TOKEN || '',
  GHCR_PULL_TOKEN:        process.env.GHCR_PULL_TOKEN || '',
  BACKUP_AGE_RECIPIENT:   process.env.BACKUP_AGE_RECIPIENT || '',
  BACKUP_AGE_IDENTITY:    process.env.BACKUP_AGE_IDENTITY || '',
  RCLONE_CONFIG:          process.env.RCLONE_CONFIG || '',
};
const BOOTSTRAP_VARIABLES = {
  CADDY_EMAIL:    process.env.CADDY_EMAIL || '',
  SSH_PUBKEY:     process.env.SSH_PUBKEY || '',
  SENTRY_ORG:     process.env.SENTRY_ORG || '',
  SENTRY_PROJECT: process.env.SENTRY_PROJECT || '',
  CF_ZONE:        process.env.CF_ZONE || '',
};

if (!values.plan) bail('new-project', `--plan <path-to-json> is required`);
const plan = JSON.parse(await readFile(values.plan, 'utf8'));

// The /new-project.yml workflow uses a minimal plan shape: {slug, displayName,
// ghOwner, domain, env, entities}. Normalize it to the full internal shape.
if (plan.ghOwner && !plan.owner) plan.owner = plan.ghOwner;

for (const k of ['owner', 'slug', 'displayName', 'domain', 'entities']) {
  if (!plan[k]) bail('new-project', `plan missing required field: ${k}`);
}
if (!Array.isArray(plan.entities) || plan.entities.length === 0) bail('new-project', `plan.entities must be a non-empty array`);

const templateOwner = plan.templateOwner || 'tariq-alnuaimi';
const templateRepo = plan.templateRepo || 'fullstack-vibe-template';

if (!DRY) {
  for (const k of ['gh-token', 'do-token', 'cf-token', 'ssh-pubkey', 'caddy-email']) {
    if (!values[k]) bail('new-project', `--${k} is required for non-dry runs`);
  }
}

const workDir = values['work-dir'] || mkdtempSync(join(tmpdir(), 'new-project-'));
info('new-project', `${DRYP}work dir: ${workDir}`);

// -- 1. Create repo from template -------------------------------------------

step('new-project', `${DRYP}creating ${plan.owner}/${plan.slug} from template`);
if (!DRY) {
  await GH.createRepoFromTemplate(values['gh-token'], {
    templateOwner, templateRepo,
    owner: plan.owner, name: plan.slug,
    description: plan.description, isPrivate: true,
  }).catch(e => {
    if (String(e.message).includes('already exists') || String(e.message).includes('Name already exists')) {
      warn('new-project', `repo ${plan.owner}/${plan.slug} already exists; reusing it`);
    } else throw e;
  });
  await GH.waitForRepoReady(values['gh-token'], plan.owner, plan.slug);
  ok('new-project', `repo ready`);
}

// -- 1b. Bootstrap secrets + variables on the new fork ---------------------
//
// Without this step the new fork has zero secrets, so the /deploy workflow
// (triggered below) would bail on the first env-var lookup. The GH API
// cannot READ secret values back, so the only way to "copy" the template's
// secrets is to receive them as env vars (set by new-project.yml's job env
// block from `${{ secrets.* }}`) and PUT them onto the fork.

step('new-project', `${DRYP}seeding ${plan.owner}/${plan.slug} with operator's account-wide secrets + variables`);
if (!DRY) {
  const secretsToSet = Object.fromEntries(
    Object.entries(BOOTSTRAP_SECRETS).filter(([, v]) => v && v !== ''),
  );
  const missingSecrets = Object.entries(BOOTSTRAP_SECRETS).filter(([, v]) => !v).map(([k]) => k);
  if (missingSecrets.length) {
    warn('new-project', `bootstrap secrets unset on template (will be missing on fork): ${missingSecrets.join(', ')}`);
  }
  const seededSecretNames = await GH.setManyRepoSecrets(values['gh-token'], plan.owner, plan.slug, secretsToSet);
  ok('new-project', `set ${seededSecretNames.length} repo secrets on fork`);

  const varsToSet = Object.fromEntries(
    Object.entries(BOOTSTRAP_VARIABLES).filter(([, v]) => v && v !== ''),
  );
  const seededVarNames = await GH.setManyRepoVariables(values['gh-token'], plan.owner, plan.slug, varsToSet);
  ok('new-project', `set ${seededVarNames.length} repo variables on fork`);

  // Provision the staging environment up front so /deploy doesn't have to
  // (it can, but doing it here lets us also drop env-scoped SENTRY_DSN).
  await GH.ensureEnvironment(values['gh-token'], plan.owner, plan.slug, 'staging');
  if (process.env.SENTRY_DSN) {
    try {
      await GH.setEnvVariable(values['gh-token'], plan.owner, plan.slug, 'staging', 'SENTRY_DSN', process.env.SENTRY_DSN);
      ok('new-project', `set SENTRY_DSN on staging environment (operator can override per-project)`);
    } catch (e) {
      warn('new-project', `setting SENTRY_DSN on staging env failed (non-fatal): ${e.message}`);
    }
  }
}

// -- 2. Clone -------------------------------------------------------------

const repoDir = join(workDir, plan.slug);
if (!existsSync(repoDir)) {
  step('new-project', `${DRYP}cloning into ${repoDir}`);
  if (!DRY) {
    const cloneUrl = `https://${values['gh-token']}@github.com/${plan.owner}/${plan.slug}.git`;
    const r = spawnSync('git', ['clone', '--depth', '20', cloneUrl, repoDir], { stdio: 'inherit' });
    if (r.status !== 0) bail('new-project', `git clone failed`);
  }
}

// -- 3. Rebrand -----------------------------------------------------------

step('new-project', `${DRYP}rebranding to ${plan.slug} / "${plan.displayName}"`);
if (!DRY) {
  const r = spawnSync('npm', ['run', 'rebrand', '--', '--slug', plan.slug, '--name', plan.displayName, '--owner', plan.owner], { cwd: repoDir, stdio: 'inherit' });
  if (r.status !== 0) bail('new-project', `rebrand failed`);
}

// -- 4. Scaffold each entity -----------------------------------------------

for (const e of plan.entities) {
  step('new-project', `${DRYP}scaffolding ${e.name}`);
  if (!DRY) {
    const args = ['run', 'scaffold', '--', '--name', e.name];
    if (e.fields) args.push('--fields', e.fields);
    if (e.enums) args.push('--enums', e.enums);
    if (e.relations) args.push('--relations', e.relations);
    if (e.adminWrites) args.push('--admin-writes', 'true');
    if (e.softDelete === false) args.push('--soft-delete', 'false');
    const r = spawnSync('npm', args, { cwd: repoDir, stdio: 'inherit' });
    if (r.status !== 0) bail('new-project', `scaffold ${e.name} failed`);
  }
}

// -- 5. Commit + push ------------------------------------------------------

step('new-project', `${DRYP}committing + pushing initial scaffold`);
if (!DRY) {
  spawnSync('git', ['add', '-A'], { cwd: repoDir });
  spawnSync('git', ['-c', 'user.email=automation@rihal.local', '-c', 'user.name=automation', 'commit', '-m', `chore: initial scaffold from /new-project\n\nEntities: ${plan.entities.map(e => e.name).join(', ')}`], { cwd: repoDir });
  const r = spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir });
  if (r.status !== 0) warn('new-project', `git push exit ${r.status} -- the repo may already have content. Check ${repoDir}.`);
}

// -- 6. Deploy to staging --------------------------------------------------
//
// Now that the new fork has its own secrets + variables (step 1b), the
// cleanest path is to dispatch /deploy on the FORK itself. The fork's CI
// will load DO/CF/GH/SSH/GHCR/BACKUP secrets from its repo, run the same
// .github/workflows/deploy.yml, and persist its own deploy-state branch.
//
// The previous local-run path is preserved as a fallback for when
// --skip-deploy is not set but GH workflow dispatch fails (e.g. webhook
// quota). We try dispatch first.

if (!values['skip-deploy']) {
  step('new-project', `${DRYP}dispatching staging /deploy on ${plan.owner}/${plan.slug}`);
  if (!DRY) {
    try {
      await GH.dispatchWorkflow(values['gh-token'], plan.owner, plan.slug, 'deploy.yml', 'main', {
        env: 'staging',
        domain: plan.domain,
        slug: plan.slug,
        action: 'provision-and-deploy',
      });
      ok('new-project', `dispatched deploy.yml on ${plan.owner}/${plan.slug}@main; tail via 'gh run watch -R ${plan.owner}/${plan.slug}'`);
    } catch (e) {
      warn('new-project', `dispatch failed (${e.message}); falling back to local deploy run`);
      const args = ['run', 'deploy', '--',
        '--env', 'staging',
        '--slug', plan.slug,
        '--domain', plan.domain,
        '--do-token', values['do-token'],
        '--cf-token', values['cf-token'],
        '--gh-token', values['gh-token'],
        '--gh-owner', plan.owner,
        '--gh-repo', plan.slug,
        '--ssh-pubkey', values['ssh-pubkey'],
        '--caddy-email', values['caddy-email'],
        '--yes',
      ];
      if (process.env.GHCR_PULL_TOKEN) args.push('--ghcr-pull-token', process.env.GHCR_PULL_TOKEN);
      if (process.env.BACKUP_AGE_RECIPIENT) args.push('--backup-age-recipient', process.env.BACKUP_AGE_RECIPIENT);
      if (process.env.RCLONE_CONFIG) args.push('--rclone-config', process.env.RCLONE_CONFIG);
      const r = spawnSync('npm', args, { cwd: repoDir, stdio: 'inherit' });
      if (r.status !== 0) bail('new-project', `deploy failed`);
    }
  }
}

// -- Done -----------------------------------------------------------------

console.log('');
ok('new-project', `${DRYP}${plan.slug} ready.`);
console.log(`  Repo:        https://github.com/${plan.owner}/${plan.slug}`);
console.log(`  Local:       ${repoDir}`);
console.log(`  Staging URL: https://${plan.domain}`);
console.log(`  Entities:    ${plan.entities.map(e => e.name).join(', ')}`);
