// scripts/lib/better-uptime.mjs
//
// Minimal Better Uptime / Better Stack API client used by /deploy to register
// an uptime monitor per environment after first deploy succeeds. See ADR-002.
//
// Endpoints documented at https://betterstack.com/docs/uptime/api/
//
// No npm deps -- uses fetch (Node 18+). Throws on 4xx/5xx with a useful body
// so the operator can see why a key is wrong / scope is missing.

const BASE = 'https://uptime.betterstack.com/api/v2';

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`better-uptime ${opts.method || 'GET'} ${url} -> ${res.status} ${body.slice(0, 300)}`);
  }
  // DELETE returns 204 with no body
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Create a status monitor for the given URL. Returns { id, attributes }
 * on success. Caller is responsible for idempotency via getMonitorByUrl.
 */
export async function createMonitor({ apiKey, url, name }) {
  if (!apiKey) throw new Error('createMonitor: apiKey is required');
  if (!url) throw new Error('createMonitor: url is required');
  const body = {
    monitor_type: 'status',
    url,
    check_frequency: 180,         // seconds between checks (3 min)
    request_timeout: 30,
    recovery_period: 60,
    confirmation_period: 0,
    http_method: 'GET',
    expected_status_codes: [200],
    pronounceable_name: name || url,
  };
  const data = await call(`${BASE}/monitors`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  return { id: data?.data?.id, attributes: data?.data?.attributes };
}

/**
 * Look up an existing monitor by URL (for idempotency). Returns the monitor
 * id or null if no match. The API supports query-by-url out of the box.
 */
export async function getMonitorByUrl({ apiKey, url }) {
  if (!apiKey) throw new Error('getMonitorByUrl: apiKey is required');
  if (!url) throw new Error('getMonitorByUrl: url is required');
  const q = new URLSearchParams({ url }).toString();
  const data = await call(`${BASE}/monitors?${q}`, {
    method: 'GET',
    headers: authHeaders(apiKey),
  });
  const hits = data?.data || [];
  // Exact match guard -- the API may return loose matches.
  const hit = hits.find((m) => m?.attributes?.url === url) || hits[0];
  return hit ? hit.id : null;
}

/**
 * Delete a monitor by id. Used by /deploy --destroy. Treats 404 as success
 * (idempotent teardown).
 */
export async function deleteMonitor({ apiKey, id }) {
  if (!apiKey) throw new Error('deleteMonitor: apiKey is required');
  if (!id) throw new Error('deleteMonitor: id is required');
  try {
    await call(`${BASE}/monitors/${id}`, {
      method: 'DELETE',
      headers: authHeaders(apiKey),
    });
    return true;
  } catch (e) {
    if (String(e.message).includes(' -> 404 ')) return true;
    throw e;
  }
}
