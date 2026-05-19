// scripts/lib/portainer.mjs
//
// Portainer bootstrap + stack management. Installs Portainer CE on the
// freshly provisioned Droplet, claims the admin window, creates the stack
// from the repo's docker-compose.prod.yml, and registers a stack webhook
// (T-04 SHA pinning requires STACK webhook, not service).
//
// SSH is shelled out to the `ssh` binary -- no node SSH lib dep. This keeps
// the script lightweight; operators already have ssh on PATH.

import { spawn } from 'node:child_process';
import { step } from './log.mjs';

export function sshExec(host, user, command, { sshKeyPath, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'LogLevel=ERROR',
      '-o', 'ConnectTimeout=10',
    ];
    if (sshKeyPath) args.push('-i', sshKeyPath);
    args.push(`${user}@${host}`, command);

    const p = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`ssh ${host} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.stdout.on('data', c => { stdout += c.toString(); });
    p.stderr.on('data', c => { stderr += c.toString(); });
    p.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ssh ${host} exit ${code}: ${stderr || stdout}`));
    });
  });
}

export async function waitForSsh(host, user, sshKeyPath, timeoutMs = 300_000) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      await sshExec(host, user, 'echo ready', { sshKeyPath, timeoutMs: 15_000 });
      return;
    } catch (e) {
      lastErr = e.message;
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  throw new Error(`ssh to ${host} did not succeed in ${timeoutMs}ms; last error: ${lastErr}`);
}

// Block until cloud-init has finished its runcmd (Docker + Caddy install).
// `cloud-init status --wait` exits 0 on done, non-zero on error. Without this
// the Portainer install will run before /usr/bin/docker exists.
// On failure, dump the tail of /var/log/cloud-init-output.log so the operator
// can see WHAT runcmd step actually failed -- otherwise the script just
// surfaces "status: error" with no context.
export async function waitForCloudInit(host, sshKeyPath, timeoutMs = 600_000) {
  step('portainer', `waiting for cloud-init on ${host}`);
  try {
    await sshExec(host, 'root', 'cloud-init status --wait', { sshKeyPath, timeoutMs });
  } catch (e) {
    let tail = '';
    try {
      const r = await sshExec(host, 'root',
        'echo "--- /var/log/cloud-init-output.log (last 60 lines) ---"; tail -60 /var/log/cloud-init-output.log 2>&1; echo; echo "--- cloud-init status --long ---"; cloud-init status --long 2>&1 | tail -40',
        { sshKeyPath, timeoutMs: 30_000 });
      tail = r.stdout || r.stderr || '(empty)';
    } catch (logErr) {
      tail = `(failed to fetch cloud-init log: ${logErr.message})`;
    }
    throw new Error(`cloud-init reported error on ${host}.\n${tail}\n\nOriginal error: ${e.message}`);
  }
}

// Portainer install via docker run. cloud-init already installs Docker.
export async function installPortainer(host, sshKeyPath) {
  step('portainer', `installing CE on ${host}`);
  await sshExec(host, 'root', `
    docker volume create portainer_data >/dev/null 2>&1 || true
    docker rm -f portainer >/dev/null 2>&1 || true
    docker run -d --name portainer --restart=always \\
      -p 9443:9443 -p 9000:9000 \\
      -v /var/run/docker.sock:/var/run/docker.sock \\
      -v portainer_data:/data \\
      portainer/portainer-ce:latest >/dev/null
  `, { sshKeyPath });
}

// Portainer HTTP API ---------------------------------------------------------
//
// First request after install must hit /api/users/admin/init within 5 minutes
// to claim the admin window; otherwise Portainer locks down. The script does
// install + init within a few seconds so the window is rarely a problem.

async function portainerCall(baseUrl, path, init = {}, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['X-API-Key'] = token;
  // Self-signed cert on first boot -- use the agent-style fetch with
  // NODE_TLS_REJECT_UNAUTHORIZED=0 in the parent process for these calls.
  // Operators are warned about this in the skill.
  const r = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`portainer ${init.method || 'GET'} ${path} -> ${r.status}: ${body && body.message ? body.message : ''}`);
  }
  return body;
}

// Poll Portainer's /api/system/status until it returns 200. Replaces the
// fixed 15-sec sleep before initPortainerAdmin -- cold-start can take
// 20-30 sec; the fixed sleep gambled. Caller is expected to have set
// NODE_TLS_REJECT_UNAUTHORIZED=0 around this region (self-signed cert
// during first boot).
export async function pollPortainerReady(url, timeoutMs = 60_000) {
  step('portainer', `polling ${url}/api/system/status until ready`);
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/system/status`, { signal: AbortSignal.timeout(5_000) });
      if (r.status === 200) return;
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e.message || String(e);
    }
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error(`Portainer at ${url} did not become ready in ${timeoutMs}ms; last error: ${lastErr}`);
}

// Phase A health check: SSH into the Droplet and curl localhost:3000/api/health.
// Bypasses Caddy entirely so we don't depend on the LE cert being issued or
// the Caddyfile virtual-host matching (Caddy only matches the configured
// {{domain}}, so direct-IP requests fall through to its default handler).
// Proves the app container is up + DB + storage reachable.
export async function pollHealthViaSsh(host, sshKeyPath, timeoutMs = 180_000) {
  step('portainer', `phase A health: ssh curl localhost:3000/api/health on ${host}`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await sshExec(host, 'root',
        'curl -sf -o /dev/null -w "%{http_code}\\n" --max-time 5 http://localhost:3000/api/health | grep -q "^200$"',
        { sshKeyPath, timeoutMs: 15_000 });
      return true;
    } catch {
      // try again
    }
    await new Promise(res => setTimeout(res, 5000));
  }
  return false;
}

export async function initPortainerAdmin(baseUrl, password) {
  step('portainer', `claiming admin window at ${baseUrl}`);
  // The init endpoint disables itself after first call. Use a long username
  // -- Portainer rejects "admin"/"root" via complexity defaults in newer
  // builds; "ops-admin" is safe.
  await portainerCall(baseUrl, '/api/users/admin/init', {
    method: 'POST',
    body: JSON.stringify({ Username: 'ops-admin', Password: password }),
  });
}

export async function getPortainerJwt(baseUrl, username, password) {
  const body = await portainerCall(baseUrl, '/api/auth', {
    method: 'POST',
    body: JSON.stringify({ Username: username, Password: password }),
  });
  return body.jwt;
}

// Endpoint = the local Docker engine on the Droplet. Portainer CE 2.19+ does
// NOT auto-create the local endpoint on admin init -- the "Get Started" /
// quick-setup flow in the UI does. Since we never touch the UI, we POST one
// via API on first access if missing.
export async function getLocalEndpointId(baseUrl, jwt) {
  let r = await fetch(`${baseUrl}/api/endpoints`, { headers: { Authorization: `Bearer ${jwt}` } });
  let list = await r.json();
  if (!Array.isArray(list) || list.length === 0) {
    step('portainer', 'no endpoints found; creating local Docker endpoint via mounted socket');
    // POST /api/endpoints expects multipart/form-data, NOT JSON.
    // EndpointCreationType=1 = local Docker via socket. The portainer
    // container was launched with `-v /var/run/docker.sock:/var/run/docker.sock`
    // (see installPortainer above), so unix:///var/run/docker.sock is reachable.
    const fd = new FormData();
    fd.append('Name', 'primary');
    fd.append('EndpointCreationType', '1');
    const createR = await fetch(`${baseUrl}/api/endpoints`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: fd,
    });
    if (!createR.ok) {
      const errBody = await createR.text().catch(() => '');
      throw new Error(`portainer create local endpoint -> ${createR.status}: ${errBody}`);
    }
    r = await fetch(`${baseUrl}/api/endpoints`, { headers: { Authorization: `Bearer ${jwt}` } });
    list = await r.json();
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('Portainer endpoint POST succeeded but list still empty');
    }
  }
  const local = list.find(e => e.Type === 1 || e.Name === 'local' || e.Name === 'primary');
  return local ? local.Id : list[0].Id;
}

export async function createComposeStack(baseUrl, jwt, endpointId, { name, composeYaml, envVars }) {
  step('portainer', `creating stack ${name} from compose`);
  const r = await fetch(`${baseUrl}/api/stacks/create/standalone/string?endpointId=${endpointId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      Name: name,
      StackFileContent: composeYaml,
      Env: Object.entries(envVars).map(([name, value]) => ({ name, value: String(value) })),
    }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`portainer stack create -> ${r.status}: ${body && body.message ? body.message : ''}`);
  return body;
}

// Register a private OCI registry (GHCR, etc.) with Portainer so its daemon
// can authenticate when pulling images during stack create / webhook redeploy.
// Portainer's daemon does NOT consult /root/.docker/config.json on the host
// -- it uses ONLY registries configured here. Idempotent: updates the URL/
// credentials in place if a registry with this name or URL already exists.
//
// Type=3 is "Custom Registry" -- works for any standard OCI registry
// (ghcr.io, quay.io, etc.) on every Portainer version. The newer dedicated
// type=8 (GitHub Container Registry) isn't supported on older Portainer CE
// images, so we stick with the universal type=3.
export async function ensureRegistry(baseUrl, jwt, { name, url, username, password }) {
  step('portainer', `ensuring registry ${name} (${url}) for private image pulls`);
  const listR = await fetch(`${baseUrl}/api/registries`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!listR.ok) {
    const eb = await listR.text().catch(() => '');
    throw new Error(`portainer list registries -> ${listR.status}: ${eb}`);
  }
  const list = await listR.json().catch(() => []);
  const existing = Array.isArray(list)
    ? list.find(x => (x.URL || '').toLowerCase() === url.toLowerCase() || x.Name === name)
    : null;
  const payload = {
    Name: name,
    Type: 3,
    URL: url,
    Authentication: true,
    Username: username,
    Password: password,
  };
  if (existing) {
    const u = await fetch(`${baseUrl}/api/registries/${existing.Id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(payload),
    });
    if (!u.ok) {
      const eb = await u.text().catch(() => '');
      throw new Error(`portainer registry update -> ${u.status}: ${eb}`);
    }
    return existing.Id;
  }
  const c = await fetch(`${baseUrl}/api/registries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(payload),
  });
  if (!c.ok) {
    const eb = await c.text().catch(() => '');
    throw new Error(`portainer registry create -> ${c.status}: ${eb}`);
  }
  const body = await c.json().catch(() => ({}));
  return body.Id;
}

export async function createStackWebhook(baseUrl, jwt, stackId) {
  step('portainer', `registering stack webhook for stack ${stackId}`);
  // Stack webhook URL pattern: <baseUrl>/api/stacks/webhooks/<token>
  // Newer Portainer versions auto-create on stack creation; this is a guard.
  const r = await fetch(`${baseUrl}/api/stacks/${stackId}/webhook`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`portainer webhook create -> ${r.status}: ${body && body.message ? body.message : ''}`);
  return body;
}

export async function triggerStackWebhook(webhookUrl, imageTag) {
  const url = imageTag ? `${webhookUrl}?IMAGE_TAG=${encodeURIComponent(imageTag)}` : webhookUrl;
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok) throw new Error(`portainer webhook trigger -> ${r.status}`);
  return true;
}
