// scripts/lib/state.mjs
//
// Idempotent state file IO for the deploy pipeline.
//
// Each environment gets its own JSON file at `.deploy-state.<env>.json` in the
// repo root. Scripts read it on entry, write resource IDs as they go, and
// re-reads on rerun let `--resume` skip already-created resources.
//
// State file is gitignored (see top-level .gitignore additions).

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();

export function statePath(env) {
  if (!env) throw new Error('statePath: env is required');
  return join(ROOT, `.deploy-state.${env}.json`);
}

export async function readState(env) {
  try {
    const raw = await readFile(statePath(env), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code === 'ENOENT') return emptyState(env);
    throw e;
  }
}

export async function writeState(env, state) {
  const out = { ...state, env, updatedAt: new Date().toISOString() };
  await writeFile(statePath(env), JSON.stringify(out, null, 2) + '\n');
  return out;
}

export function emptyState(env) {
  return {
    env,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slug: null,
    domain: null,
    droplet: null,        // { id, ip, reservedIp, region, size }
    spaces: null,         // { bucket, region, endpoint, accessKey, secretKey }
    cloudflare: null,     // { zoneId, recordId, name }
    portainer: null,      // { url, adminPassword, stackId, webhookId, webhookUrl }
    github: null,         // { repo, secretsSet: [...], envSet: [...] }
    deployedSha: null,
    betterUptimeMonitorId: null,  // ADR-002: per-env uptime monitor id (null if BETTER_UPTIME_API_KEY unset)
  };
}

export function mark(state, key, value) {
  return { ...state, [key]: value };
}
