#!/usr/bin/env node
// scripts/release.mjs
//
// Drafts a CHANGELOG entry + GitHub release on each prod promotion. Designed
// to run after `/promote` (composable, not auto-triggered) -- see ADR-003.
//
// Usage:
//   npm run release -- --tag prod-20260518-1530          # explicit tag
//   npm run release -- --auto                            # use the latest prod-* tag
//   npm run release -- --tag prod-20260518-1530 --dry-run
//
// Reads:    git tags + git log
// Writes:   CHANGELOG.md (prepends new section)
// Calls:    POST /repos/{owner}/{repo}/releases with GITHUB_TOKEN
// Commits:  chore(release): <tag>
//
// Refusal cases:
//   - --tag does not exist locally / on origin
//   - GITHUB_TOKEN unset and not --dry-run
//   - No previous prod-* tag AND --tag is the first ever: still works, diff
//     base is the repo root commit.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { info, step, ok, warn, bail, dryPrefix } from './lib/log.mjs';

const ROOT = process.cwd();

const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    auto: { type: 'boolean', default: false },
    'gh-owner': { type: 'string' },
    'gh-repo': { type: 'string' },
    'gh-token': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'no-commit': { type: 'boolean', default: false },
    'no-push': { type: 'boolean', default: false },
  },
  strict: true,
});

const DRY = values['dry-run'];
const DRYP = dryPrefix(DRY);
const TOKEN = values['gh-token'] || process.env.GITHUB_TOKEN;

if (!values.tag && !values.auto) bail('release', '--tag <prod-...> or --auto is required');
if (!DRY && !TOKEN) bail('release', 'GITHUB_TOKEN env (or --gh-token) is required for non-dry runs');

// -- Resolve repo + tag -----------------------------------------------------

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function listProdTags() {
  // Sort by creatordate descending so [0] is newest.
  const raw = git(`tag --list 'prod-*' --sort=-creatordate`);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function resolveRepo() {
  if (values['gh-owner'] && values['gh-repo']) return { owner: values['gh-owner'], repo: values['gh-repo'] };
  const url = git('config --get remote.origin.url');
  const m = url.match(/[:/]([^:/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!m) bail('release', 'could not derive GH repo from git remote');
  return { owner: m[1], repo: m[2] };
}

const tags = listProdTags();
const tag = values.tag || tags[0];
if (!tag) bail('release', 'no prod-* tags found; create one via /promote first');
if (!tags.includes(tag)) bail('release', `tag "${tag}" not found in local repo (run: git fetch --tags)`);

const prevTag = tags.find((t) => t !== tag && tags.indexOf(t) > tags.indexOf(tag)) || tags[tags.indexOf(tag) + 1] || null;
const { owner, repo } = resolveRepo();

info('release', `tag: ${tag}`);
info('release', `previous: ${prevTag || '(none -- first prod release)'}`);
info('release', `repo: ${owner}/${repo}`);

// -- Compute diff + categorize ---------------------------------------------

const range = prevTag ? `${prevTag}..${tag}` : tag;
const logOut = git(`log --pretty=format:%s|%h ${range}`);
const commits = logOut.split('\n').filter(Boolean).map((line) => {
  const [subject, sha] = line.split('|');
  return { subject, sha };
});

if (commits.length === 0) {
  warn('release', `no commits between ${prevTag || 'root'} and ${tag} -- skipping CHANGELOG entry`);
  process.exit(0);
}

// Conventional Commits prefix -> bucket. Bucket order in the changelog
// follows this object's insertion order.
const BUCKETS = {
  feat: 'Features',
  fix: 'Fixes',
  perf: 'Performance',
  refactor: 'Refactors',
  docs: 'Docs',
  test: 'Tests',
  build: 'Build',
  ci: 'CI',
  chore: 'Chores',
  style: 'Style',
  revert: 'Reverts',
};

const grouped = {};
const other = [];
for (const c of commits) {
  const m = c.subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s*(.+)$/);
  if (m && BUCKETS[m[1]]) {
    (grouped[m[1]] = grouped[m[1]] || []).push({ ...c, message: m[2] });
  } else {
    other.push({ ...c, message: c.subject });
  }
}

const today = new Date().toISOString().slice(0, 10);
let entry = `## ${tag} — ${today}\n\n`;
for (const key of Object.keys(BUCKETS)) {
  if (!grouped[key]) continue;
  entry += `### ${BUCKETS[key]}\n`;
  for (const c of grouped[key]) entry += `- ${c.message} (${c.sha})\n`;
  entry += `\n`;
}
if (other.length) {
  entry += `### Other\n`;
  for (const c of other) entry += `- ${c.message} (${c.sha})\n`;
  entry += `\n`;
}

step('release', `${DRYP}drafting CHANGELOG entry (${commits.length} commits)`);
if (DRY) {
  console.log('\n' + entry);
}

// -- Prepend to CHANGELOG.md ------------------------------------------------

const changelogPath = join(ROOT, 'CHANGELOG.md');
let prior = '';
try {
  prior = await readFile(changelogPath, 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

const HEADER = '# Changelog\n\nGenerated by `/release` after each prod promotion. See ADR-003.\n\n';
let next;
if (!prior) {
  next = HEADER + entry;
} else if (prior.startsWith('# Changelog')) {
  // Insert after header block (up through first blank line after the header).
  const idx = prior.indexOf('\n\n');
  if (idx === -1) next = prior + '\n\n' + entry;
  else next = prior.slice(0, idx + 2) + entry + prior.slice(idx + 2);
} else {
  next = HEADER + entry + prior;
}

if (!DRY) {
  await writeFile(changelogPath, next);
  ok('release', `wrote CHANGELOG.md`);
}

// -- Commit + push ----------------------------------------------------------

if (!DRY && !values['no-commit']) {
  try {
    execSync(`git add CHANGELOG.md`, { stdio: 'inherit' });
    execSync(`git commit -m "chore(release): ${tag}"`, { stdio: 'inherit' });
    ok('release', `committed CHANGELOG.md`);
    if (!values['no-push']) {
      execSync(`git push`, { stdio: 'inherit' });
      ok('release', `pushed`);
    }
  } catch (e) {
    warn('release', `commit/push failed (continuing): ${e.message}`);
  }
}

// -- GH release -------------------------------------------------------------

if (!DRY) {
  step('release', `creating GitHub release for ${tag}`);
  const body = entry.split('\n').slice(2).join('\n');  // drop the "## tag — date" line
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body,
      draft: false,
      prerelease: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422 && text.includes('already_exists')) {
      warn('release', `release ${tag} already exists -- skipping`);
    } else {
      bail('release', `GH release POST -> ${res.status} ${text.slice(0, 400)}`);
    }
  } else {
    const json = await res.json();
    ok('release', `release URL: ${json.html_url}`);
  }
}

ok('release', `${DRYP}done.`);
