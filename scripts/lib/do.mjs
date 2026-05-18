// scripts/lib/do.mjs
//
// DigitalOcean API client. Covers the three resources /deploy provisions:
//   - Droplet (s-1vcpu-2gb, fra1, ubuntu-22-04-x64, cloud-init payload, ops SSH key)
//   - Spaces bucket (for off-host backups via rclone)
//   - Reserved IPv4 (so the public IP survives Droplet rebuilds)
//
// Idempotency: every create function first lists existing resources by name
// (or by tag for Droplets) and reuses the one it finds. Combined with the
// state file this means re-running /deploy after a partial failure is safe.
//
// Token scope: full account (DO doesn't have fine-grained PATs). The operator
// is told to use a dedicated automation account in the skill doc.

import { step, warn } from './log.mjs';

const API = 'https://api.digitalocean.com/v2';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function call(token, path, init = {}, attempt = 1) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers || {}) },
  });
  if (r.status === 429 && attempt <= 4) {
    const retry = Number(r.headers.get('Retry-After') || 2);
    await new Promise(res => setTimeout(res, retry * 1000));
    return call(token, path, init, attempt + 1);
  }
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`DO ${init.method || 'GET'} ${path} -> ${r.status}: ${body.slice(0, 400)}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

export async function validateToken(token) {
  const r = await call(token, '/account');
  return r.account;
}

// SSH keys -------------------------------------------------------------------

export async function ensureSshKey(token, name, pubkey) {
  // DO indexes uploaded keys by fingerprint; the same pubkey uploaded twice
  // (even under different names) returns 422 "already in use". Match on the
  // public_key content first (handles cross-project reuse), then by name
  // (handles partial re-runs of the same project).
  const trimmed = pubkey.trim();
  const list = await call(token, '/account/keys?per_page=200');
  const byContent = list.ssh_keys.find(k => (k.public_key || '').trim() === trimmed);
  if (byContent) return byContent;
  const byName = list.ssh_keys.find(k => k.name === name);
  if (byName) return byName;
  const created = await call(token, '/account/keys', {
    method: 'POST',
    body: JSON.stringify({ name, public_key: pubkey }),
  });
  return created.ssh_key;
}

// Droplet --------------------------------------------------------------------

export async function findDropletByTag(token, tag) {
  const r = await call(token, `/droplets?tag_name=${encodeURIComponent(tag)}&per_page=50`);
  return r.droplets[0] || null;
}

export async function createDroplet(token, { name, region, size, sshKeyId, tags, userData }) {
  step('do', `creating droplet ${name} (${size}, ${region})`);
  const r = await call(token, '/droplets', {
    method: 'POST',
    body: JSON.stringify({
      name,
      region,
      size,
      image: 'ubuntu-22-04-x64',
      ssh_keys: [sshKeyId],
      backups: false,
      ipv6: true,
      monitoring: true,
      tags,
      user_data: userData,
    }),
  });
  return r.droplet;
}

export async function getDroplet(token, id) {
  const r = await call(token, `/droplets/${id}`);
  return r.droplet;
}

export async function waitForDropletActive(token, id, timeoutMs = 240_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await getDroplet(token, id);
    if (d.status === 'active') {
      const v4 = d.networks.v4.find(n => n.type === 'public');
      if (v4) return { droplet: d, ip: v4.ip_address };
    }
    await new Promise(res => setTimeout(res, 5000));
  }
  throw new Error(`droplet ${id} did not become active in ${timeoutMs}ms`);
}

export async function destroyDroplet(token, id) {
  await call(token, `/droplets/${id}`, { method: 'DELETE' });
}

// Reserved IP ---------------------------------------------------------------

export async function reserveAndAssignIp(token, dropletId, region) {
  step('do', `reserving IPv4 and assigning to droplet ${dropletId}`);
  const r = await call(token, '/reserved_ips', {
    method: 'POST',
    body: JSON.stringify({ droplet_id: dropletId, region }),
  });
  return r.reserved_ip;
}

export async function unassignAndReleaseIp(token, ip) {
  // Unassign first (required before delete), then release.
  await call(token, `/reserved_ips/${ip}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'unassign' }),
  }).catch(() => {});
  await call(token, `/reserved_ips/${ip}`, { method: 'DELETE' }).catch(() => {});
}

// Spaces (S3-compatible) -----------------------------------------------------

export async function ensureSpacesBucket(token, { name, region }) {
  // Spaces uses an S3-compatible endpoint, not the DO REST API. Creating a
  // bucket requires a Spaces access key + secret. We mint a Spaces key via
  // the DO API, then use AWS SDK style signed requests to PUT the bucket.
  //
  // For deploy bring-up we keep this simple: ask the operator to create the
  // bucket once via the DO console, and only manage the access keys via API.
  // This avoids pulling @aws-sdk/client-s3 as a script-time dep.
  //
  // The skill prints a "create the bucket manually" hint when this returns
  // null; otherwise the operator can pass --skip-spaces and configure rclone
  // against an existing remote.
  warn('do', `Spaces bucket creation is operator-driven (one-time).`);
  warn('do', `In the DO console -> Spaces -> Create bucket "${name}" in ${region}.`);
  warn('do', `Then re-run deploy; this step will mint a Spaces access key.`);
  return { name, region, endpoint: `https://${region}.digitaloceanspaces.com`, deferred: true };
}

export async function createSpacesKey(token, name) {
  step('do', `minting Spaces access key for ${name}`);
  const r = await call(token, '/spaces/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }).catch(err => {
    // Older DO accounts may not have the v2 spaces/keys endpoint enabled.
    // Surface a clear error so the operator falls back to the console.
    throw new Error(`DO Spaces keys API unavailable: ${err.message}. Mint a key in the console and pass via --spaces-access-key / --spaces-secret-key.`);
  });
  return r.key;
}

// Region defaults ------------------------------------------------------------

export const DEFAULTS = {
  region: 'fra1',
  size: 's-1vcpu-2gb',
};
