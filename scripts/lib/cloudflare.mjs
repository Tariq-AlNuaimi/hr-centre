// scripts/lib/cloudflare.mjs
//
// Cloudflare DNS API. /deploy creates one A record per environment pointing
// at the reserved IP. Proxied=false (grey cloud) is mandatory -- Caddy's
// Let's Encrypt HTTP-01 challenge needs the origin reachable directly.
//
// Token scope expected: Zone.DNS:Edit on a single zone. Script validates the
// token shape upfront via /user/tokens/verify before any mutating call.

import { step, ok, warn } from './log.mjs';

const API = 'https://api.cloudflare.com/client/v4';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function call(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false) {
    const errs = (body.errors || []).map(e => `${e.code}: ${e.message}`).join(', ');
    throw new Error(`CF ${init.method || 'GET'} ${path} -> ${r.status}: ${errs || JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

export async function validateToken(token) {
  const body = await call(token, '/user/tokens/verify');
  return body.result;
}

export async function findZoneByName(token, zoneName) {
  const body = await call(token, `/zones?name=${encodeURIComponent(zoneName)}`);
  return body.result[0] || null;
}

export function rootDomain(fqdn) {
  // Naive 2-label root for common TLDs. Operators with .co.uk / .com.om
  // domains should pass --cf-zone explicitly to deploy.mjs.
  const parts = fqdn.split('.');
  if (parts.length < 2) throw new Error(`invalid fqdn: ${fqdn}`);
  return parts.slice(-2).join('.');
}

export async function upsertARecord(token, zoneId, { name, ip, ttl = 60 }) {
  step('cf', `upserting A ${name} -> ${ip} (proxied=false)`);
  const existing = await call(token, `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`);
  if (existing.result.length > 0) {
    const rec = existing.result[0];
    if (rec.proxied === true) {
      warn('cf', `record ${name} is proxied=true. Setting to proxied=false (required for LE HTTP-01).`);
    }
    const updated = await call(token, `/zones/${zoneId}/dns_records/${rec.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'A', name, content: ip, ttl, proxied: false }),
    });
    return updated.result;
  }
  const created = await call(token, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'A', name, content: ip, ttl, proxied: false }),
  });
  return created.result;
}

export async function deleteRecord(token, zoneId, recordId) {
  await call(token, `/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
}
