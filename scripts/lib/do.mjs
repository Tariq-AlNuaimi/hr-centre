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

// ssh-ed25519 <base64-body> <optional comment>  → returns <base64-body>.
// The base64 body is the part DO computes the fingerprint from. Comparing
// it directly is invariant to comment normalization (DO may strip / trim /
// re-encode the `azuread\user@host` comment when storing).
function keyBody(pubkey) {
  const parts = (pubkey || '').trim().split(/\s+/);
  return parts.length >= 2 ? parts[1] : (pubkey || '').trim();
}

export async function ensureSshKey(token, name, pubkey) {
  // DO rejects POST /account/keys with 422 if the same fingerprint already
  // exists, regardless of the requested name. Match on the base64 key body
  // first (handles cross-project reuse where every fork shares one id_ed25519
  // and DO has normalized the stored comment), then by name (handles partial
  // re-runs of the same project), only then POST.
  const body = keyBody(pubkey);
  const list = await call(token, '/account/keys?per_page=200');
  // Skip any candidate where public_key is missing or empty so an unrelated
  // key can't false-match against an empty key body. (LOW #9)
  const candidates = list.ssh_keys.filter(k => k.public_key && k.public_key.trim());
  const byBody = candidates.find(k => keyBody(k.public_key) === body);
  if (byBody) return byBody;
  const byName = candidates.find(k => k.name === name);
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

export async function createDroplet(token, { name, region, size, sshKeyId, tags, userData, image }) {
  // `image` can be:
  //   - undefined / falsy -> use stock Ubuntu 22.04 (the long-standing default; runs full cloud-init apt install)
  //   - a snapshot ID (numeric string, e.g. '141234567') -> boot from a pre-baked snapshot (skips ~4 min of apt installs)
  //   - any other DO image slug -> passthrough (advanced use)
  const imageRef = image || 'ubuntu-22-04-x64';
  step('do', `creating droplet ${name} (${size}, ${region}, image=${imageRef})`);
  const r = await call(token, '/droplets', {
    method: 'POST',
    body: JSON.stringify({
      name,
      region,
      size,
      image: imageRef,
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

// Snapshots ------------------------------------------------------------------
//
// Used by scripts/build-snapshot.mjs to pre-bake a custom image with Docker +
// Caddy + age + rclone pre-installed. /deploy then boots droplets from that
// snapshot, skipping the ~4 min apt install phase of cloud-init.

export async function powerOffDroplet(token, id) {
  // DO snapshot quality is better when the droplet is powered off. The action
  // is async; the caller should waitForDropletStatus(token, id, 'off').
  step('do', `powering off droplet ${id} (for clean snapshot)`);
  const r = await call(token, `/droplets/${id}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'power_off' }),
  });
  return r.action;
}

export async function waitForDropletStatus(token, id, status, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await getDroplet(token, id);
    if (d.status === status) return d;
    await new Promise(res => setTimeout(res, 5000));
  }
  throw new Error(`droplet ${id} did not reach status="${status}" in ${timeoutMs}ms`);
}

export async function createSnapshot(token, dropletId, name) {
  // Returns the action object. Snapshot creation is slow (3-6 min on a small
  // droplet) so the caller MUST waitForDropletActionComplete with a generous
  // timeout (e.g. 10 min). Action status is one of 'in-progress' | 'completed' | 'errored'.
  step('do', `creating snapshot "${name}" from droplet ${dropletId}`);
  const r = await call(token, `/droplets/${dropletId}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'snapshot', name }),
  });
  return r.action;
}

export async function getDropletAction(token, dropletId, actionId) {
  const r = await call(token, `/droplets/${dropletId}/actions/${actionId}`);
  return r.action;
}

export async function waitForDropletActionComplete(token, dropletId, actionId, timeoutMs = 600_000) {
  // Snapshots take 3-6 min; 10 min ceiling covers slow days.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const a = await getDropletAction(token, dropletId, actionId);
    if (a.status === 'completed') return a;
    if (a.status === 'errored') throw new Error(`droplet action ${actionId} errored: ${JSON.stringify(a)}`);
    await new Promise(res => setTimeout(res, 10_000));
  }
  throw new Error(`droplet action ${actionId} did not complete in ${timeoutMs}ms`);
}

export async function findSnapshotByName(token, name) {
  // GET /snapshots?resource_type=droplet paginates at 200/page; we only have a
  // handful of snapshots in practice so one page is fine.
  const r = await call(token, `/snapshots?resource_type=droplet&per_page=200`);
  return (r.snapshots || []).find(s => s.name === name) || null;
}

export async function listSnapshots(token, { namePrefix } = {}) {
  const r = await call(token, `/snapshots?resource_type=droplet&per_page=200`);
  const all = r.snapshots || [];
  if (!namePrefix) return all;
  return all.filter(s => s.name && s.name.startsWith(namePrefix));
}

export async function destroySnapshot(token, snapshotId) {
  // Used by build-snapshot when --force-rebuild is set and the previous
  // snapshot for this region needs to be removed first.
  await call(token, `/snapshots/${snapshotId}`, { method: 'DELETE' });
}

// Reserved IP ---------------------------------------------------------------

export async function reserveAndAssignIp(token, dropletId, region) {
  step('do', `reserving IPv4 and assigning to droplet ${dropletId}`);
  const r = await call(token, '/reserved_ips', {
    method: 'POST',
    body: JSON.stringify({ droplet_id: dropletId, region }),
  });
  const ip = r.reserved_ip.ip;
  // POST returns immediately but the assignment is async. We've observed
  // in production that DO sometimes returns success and then silently
  // detaches the IP -- state.droplet.reservedIp pointed at an IP that
  // routed nowhere from the public internet for 30+ minutes until the
  // operator manually reassigned via the DO console. Poll until the IP
  // is actually attached, and retry the assign up to 3x if not.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await pollIpAssigned(token, ip, dropletId, 60_000);
    if (ok) {
      step('do', `reserved IP ${ip} confirmed attached to droplet ${dropletId}`);
      return r.reserved_ip;
    }
    if (attempt < 3) {
      step('do', `reserved IP ${ip} not attached after 60s; retrying assign (attempt ${attempt + 1}/3)`);
      await call(token, `/reserved_ips/${ip}/actions`, {
        method: 'POST',
        body: JSON.stringify({ type: 'assign', droplet_id: dropletId }),
      }).catch(e => warn('do', `assign retry failed: ${e.message}`));
    }
  }
  throw new Error(`reserved IP ${ip} failed to attach to droplet ${dropletId} after 3 attempts (~3 min total). Check DO console > Networking > Reserved IPs; you may need to assign manually.`);
}

async function pollIpAssigned(token, ip, expectedDropletId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await call(token, `/reserved_ips/${ip}`);
      if (r.reserved_ip && r.reserved_ip.droplet && r.reserved_ip.droplet.id === expectedDropletId) {
        return true;
      }
    } catch (_) {}
    await new Promise(res => setTimeout(res, 3000));
  }
  return false;
}

export async function unassignAndReleaseIp(token, ip) {
  // 1) Unassign best-effort -- it's OK if the IP is already detached (the
  //    POST returns 4xx in that case). What we care about is the delete.
  await call(token, `/reserved_ips/${ip}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type: 'unassign' }),
  }).catch(() => {});
  // 2) Delete -- this is what actually releases the IP and stops the $4/mo
  //    billing. Failures here are real cost leaks; let them propagate to the
  //    caller (deploy.mjs destroy block wraps in try/catch and warns).
  //    Previously this also had `.catch(() => {})` and we ended up with 3
  //    orphaned reserved IPs ($12/mo) across multiple smoke runs.
  await call(token, `/reserved_ips/${ip}`, { method: 'DELETE' });
}

// List all reserved IPs on the account that are currently unattached
// ($4/mo each idle). Used by /deploy --destroy to nag the operator about
// orphaned IPs from prior partial runs.
export async function listUnattachedReservedIps(token) {
  const r = await call(token, '/reserved_ips?per_page=200');
  return (r.reserved_ips || []).filter(x => !x.droplet);
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
