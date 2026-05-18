// scripts/lib/state.mjs
//
// State file IO for the deploy pipeline.
//
// Each environment gets its own JSON file at `.deploy-state.<env>.json` in the
// repo root. Scripts read it on entry, write resource IDs as they go.
//
// Two transport modes (chosen by the caller, not this module):
//
//   1. Local mode (legacy): file is gitignored; the operator's laptop owns it.
//      Lost-laptop = lost state.
//   2. CI mode (ADR-004):  file is committed to an orphan `deployment-state`
//      branch via .github/actions/{restore,persist}-state. The state file is
//      written by this module into the workspace; the composite action moves it
//      between the orphan branch and the workspace before / after the script.
//
// In addition, every DO resource the deploy script creates is tagged with
//   - vibe-managed=<slug>-<env>     (project + env)
//   - vibe-resource=<type>          (droplet | reserved_ip | spaces_bucket)
// so `discoverFromTags()` can rebuild a minimal state object from DO if the
// branch is corrupted / wiped.

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

// ---------------------------------------------------------------------------
// DigitalOcean resource tagging + discovery (ADR-004 backup source-of-truth).
//
// The DO REST API accepts a list of tags on resource create (we already do
// this in lib/do.mjs createDroplet) but reserved-ips and spaces buckets need
// explicit tag-attach calls. `tagResource()` is a thin wrapper that builds the
// expected pair of tags and calls the DO `/v2/tags/<name>/resources` endpoint.
// We accept a "do_client" interface (anything with a `.call(path, init)` shape)
// to keep this module dependency-free; callers in scripts/deploy.mjs pass an
// adapter built from lib/do.mjs.
// ---------------------------------------------------------------------------

export function managedTag(slug, env) {
  return `vibe-managed=${slug}-${env}`;
}

export function resourceTag(type) {
  return `vibe-resource=${type}`;
}

/**
 * Attach the standard vibe-* tags to a DO resource. Idempotent on the DO side
 * (existing tag attachments are a no-op). The DO Spaces bucket API does not
 * accept tags directly; spaces tagging is therefore best-effort and may be a
 * no-op on accounts without the v2/spaces tagging endpoint. The caller logs.
 *
 * @param {object} do_client - lib/do.mjs-shaped client { call(token, path, init) }
 * @param {string} token     - DO API token
 * @param {string} type      - droplet | reserved_ip | spaces_bucket
 * @param {string} id        - resource identifier (droplet id, reserved ip, bucket name)
 * @param {string} slug
 * @param {string} env
 */
export async function tagResource(do_client, token, type, id, slug, env) {
  const tags = [managedTag(slug, env), resourceTag(type)];
  for (const name of tags) {
    // Ensure the tag exists (POST is idempotent: returns 409 if already there).
    try {
      await do_client.call(token, '/tags', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
    } catch (e) {
      // 409 / "already exists" is fine.
      if (!/409|already/i.test(String(e.message))) {
        // Surface but don't bail -- tagging is best-effort backup.
        // TODO: verify exact DO error shape on first real run.
      }
    }
    // Attach the tag to the resource.
    const resourceType = type === 'droplet' ? 'droplet'
      : type === 'reserved_ip' ? 'reserved_ip'
      : 'spaces_bucket';
    try {
      await do_client.call(token, `/tags/${encodeURIComponent(name)}/resources`, {
        method: 'POST',
        body: JSON.stringify({
          resources: [{ resource_id: String(id), resource_type: resourceType }],
        }),
      });
    } catch (e) {
      // Some resource types may not accept tags via this endpoint on all
      // accounts. Best-effort.
      // TODO: validate POST /v2/tags/{name}/resources for reserved_ip + spaces_bucket
      // on first real run.
    }
  }
}

/**
 * Reverse lookup: list DO resources carrying our managed tag for this
 * (slug, env). Returns a minimal partial-state shape that the caller can
 * merge with whatever is on disk.
 *
 * @returns {Promise<{ droplet: object|null, reservedIp: string|null, spacesBucket: string|null }>}
 */
export async function discoverFromTags(do_client, token, slug, env) {
  const tag = managedTag(slug, env);
  const out = { droplet: null, reservedIp: null, spacesBucket: null };
  try {
    const r = await do_client.call(token, `/droplets?tag_name=${encodeURIComponent(tag)}&per_page=50`);
    if (r && Array.isArray(r.droplets) && r.droplets[0]) {
      const d = r.droplets[0];
      const v4 = (d.networks && d.networks.v4 || []).find(n => n.type === 'public');
      out.droplet = { id: d.id, ip: v4 ? v4.ip_address : null, region: d.region && d.region.slug, size: d.size_slug };
    }
  } catch (_) { /* tag may not exist yet */ }
  try {
    const r = await do_client.call(token, `/reserved_ips?per_page=200`);
    const ip = (r && r.reserved_ips || []).find(x => x.droplet && out.droplet && x.droplet.id === out.droplet.id);
    if (ip) out.reservedIp = ip.ip;
  } catch (_) { /* */ }
  // Spaces bucket discovery is by name convention: <slug>-backups-<env>.
  out.spacesBucket = `${slug}-backups-${env}`;
  return out;
}
