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
// `cloud-init status --wait` exits 0 on done, 2 on error. Without this the
// Portainer install will run before /usr/bin/docker exists.
export async function waitForCloudInit(host, sshKeyPath, timeoutMs = 600_000) {
  step('portainer', `waiting for cloud-init on ${host}`);
  await sshExec(host, 'root', 'cloud-init status --wait', { sshKeyPath, timeoutMs });
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

// Endpoint = the local Docker engine on the Droplet. ID is typically 1 after
// fresh install but we look it up to be safe.
export async function getLocalEndpointId(baseUrl, jwt) {
  const r = await fetch(`${baseUrl}/api/endpoints`, { headers: { Authorization: `Bearer ${jwt}` } });
  const list = await r.json();
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Portainer has no endpoints');
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
