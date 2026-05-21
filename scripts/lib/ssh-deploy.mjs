// scripts/lib/ssh-deploy.mjs
//
// SSH + docker compose deploy primitives. Replaces the old portainer.mjs
// (Portainer's API surface was too unstable across versions -- registry
// config, endpoint auto-create, webhook URL shape all changed in 2.19+).
//
// New model: the deploy script writes /opt/<slug>/docker-compose.prod.yml
// + /opt/<slug>/.env on the Droplet over SSH, then runs `docker compose
// up -d`. The cloud-init-written /root/.docker/config.json provides GHCR
// auth (the host's docker daemon DOES read it -- only Portainer bypassed
// it). Redeploys (from docker-build.yml and /promote) SSH in and run
// `docker compose pull && docker compose up -d` with IMAGE_TAG=sha-xxx
// substituted into .env.
//
// No SSH lib dep -- shells out to `ssh` / `scp` on PATH (runners have it).

import { spawn } from 'node:child_process';
import { step } from './log.mjs';

const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'LogLevel=ERROR',
  '-o', 'ConnectTimeout=10',
];

export function sshExec(host, user, command, { sshKeyPath, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [...SSH_OPTS];
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

// Stream stdin to a remote file via ssh. Simpler than scp -- avoids the
// "scp from cwd" path-quoting confusion when running on CI runners. The
// remote shell writes via cat > path; we set perms in a separate call so
// secrets (.env) land 0600.
export function sshWriteFile(host, user, remotePath, content, { sshKeyPath, mode = '0644', timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [...SSH_OPTS];
    if (sshKeyPath) args.push('-i', sshKeyPath);
    // Quote remotePath defensively in case it ever contains spaces.
    const remoteCmd = `cat > '${remotePath.replace(/'/g, "'\\''")}' && chmod ${mode} '${remotePath.replace(/'/g, "'\\''")}'`;
    args.push(`${user}@${host}`, remoteCmd);

    const p = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    const t = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`ssh write ${host}:${remotePath} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.stderr.on('data', c => { stderr += c.toString(); });
    p.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`ssh write ${host}:${remotePath} exit ${code}: ${stderr}`));
    });
    p.stdin.end(content);
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

// Block until cloud-init's runcmd has finished (Docker + Caddy install).
// `cloud-init status --wait` exits 0 on done, non-zero on error. On failure,
// dump the tail of /var/log/cloud-init-output.log so the operator can see
// WHAT runcmd step actually failed.
//
// Retries SSH-level transport errors (connection reset, kex_exchange) because
// cloud-init's `ufw --force enable` briefly reloads iptables and can RST an
// in-flight SSH session. Once cloud-init has completed, sshd is stable and
// the retry succeeds. Cloud-init's own non-zero exit (which signals a runcmd
// FAILURE, not transport noise) is NOT retried -- those represent real
// runcmd errors that need the operator's attention.
export async function waitForCloudInit(host, sshKeyPath, timeoutMs = 600_000) {
  step('ssh-deploy', `waiting for cloud-init on ${host}`);
  const isTransportErr = (msg) => /kex_exchange_identification|Connection reset|Connection refused|Connection timed out|broken pipe/i.test(msg || '');
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      await sshExec(host, 'root', 'cloud-init status --wait', { sshKeyPath, timeoutMs: timeoutMs - (Date.now() - start) });
      return;
    } catch (e) {
      lastErr = e;
      if (!isTransportErr(e.message)) break;
      // SSH-level reset: backoff briefly and retry. Cloud-init is still
      // making progress; the iptables reload finishes in <5s typically.
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  // Surface the real failure with cloud-init logs (if we can fetch them).
  let tail = '';
  try {
    const r = await sshExec(host, 'root',
      'echo "--- /var/log/cloud-init-output.log (last 60 lines) ---"; tail -60 /var/log/cloud-init-output.log 2>&1; echo; echo "--- cloud-init status --long ---"; cloud-init status --long 2>&1 | tail -40',
      { sshKeyPath, timeoutMs: 30_000 });
    tail = r.stdout || r.stderr || '(empty)';
  } catch (logErr) {
    tail = `(failed to fetch cloud-init log: ${logErr.message})`;
  }
  throw new Error(`cloud-init reported error on ${host}.\n${tail}\n\nOriginal error: ${lastErr ? lastErr.message : 'unknown'}`);
}

// Build a docker-compose .env file from the env-var map. Keys with empty
// values are omitted -- compose treats `KEY=` as the empty string, not unset,
// which differs from how we want our ${KEY:-default} defaults to fire.
export function buildEnvFile(envVars) {
  const lines = [];
  for (const [k, v] of Object.entries(envVars)) {
    if (v == null || v === '') continue;
    // Quote values containing whitespace or shell metachars; otherwise leave bare.
    // Compose's .env parser doesn't do shell quote stripping, so single-quotes
    // would land in the value verbatim. The safe shape: quote only when needed.
    const s = String(v);
    if (/[\s"'$`\\]/.test(s)) {
      // Use double quotes + escape \ and "
      lines.push(`${k}="${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${k}=${s}`);
    }
  }
  return lines.join('\n') + '\n';
}

// First deploy: write compose + .env to /opt/<slug>/, then docker compose up -d.
// Subsequent calls are safe (compose up is idempotent and will recreate
// only changed services).
export async function deployStack(host, sshKeyPath, { slug, composeYaml, envVars, aux = {} }) {
  const dir = `/opt/${slug}`;
  step('ssh-deploy', `deploying ${slug} to ${host}:${dir}`);
  // mkdir + chmod 700 (only root reads -- .env has secrets)
  await sshExec(host, 'root', `mkdir -p '${dir}' && chmod 700 '${dir}'`, { sshKeyPath });
  await sshWriteFile(host, 'root', `${dir}/docker-compose.prod.yml`, composeYaml, { sshKeyPath, mode: '0644' });
  await sshWriteFile(host, 'root', `${dir}/.env`, buildEnvFile(envVars), { sshKeyPath, mode: '0600' });
  // Aux files: anything that compose bind-mounts (e.g. ./deploy/backup.sh,
  // ./deploy/backup-entrypoint.sh) and that must be on the host filesystem
  // at compose-up time. Keys are paths relative to ${dir}; values are file
  // contents. Scripts get +x (mode 0755), everything else stays 0644.
  for (const [relPath, content] of Object.entries(aux)) {
    if (content == null) continue;
    const targetPath = `${dir}/${relPath}`;
    const parent = targetPath.replace(/\/[^/]+$/, '');
    if (parent !== dir) {
      await sshExec(host, 'root', `mkdir -p '${parent}'`, { sshKeyPath });
    }
    const isScript = relPath.endsWith('.sh');
    await sshWriteFile(host, 'root', targetPath, content, { sshKeyPath, mode: isScript ? '0755' : '0644' });
  }
  // docker compose pull + up -d. Pull first so the image lands before recreate.
  // GHCR auth comes from /root/.docker/config.json written by cloud-init.
  // --remove-orphans cleans up containers from prior compose files.
  await sshExec(host, 'root',
    `cd '${dir}' && docker compose -f docker-compose.prod.yml --env-file .env pull && docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans`,
    { sshKeyPath, timeoutMs: 600_000 });
}

// Redeploy with a new IMAGE_TAG -- patches /opt/<slug>/.env in place then
// re-runs docker compose pull + up -d. Used by docker-build.yml on every
// main push (auto-deploys staging) and by /promote / /rollback (with a
// SHA tag).
export async function redeployStack(host, sshKeyPath, { slug, imageTag }) {
  const dir = `/opt/${slug}`;
  step('ssh-deploy', `redeploying ${slug} on ${host} with IMAGE_TAG=${imageTag}`);
  // Use sed to overwrite or append IMAGE_TAG. The `||` appends if no match.
  // Single-quoted sed expression escapes the slash in the value.
  const setLine = `if grep -q '^IMAGE_TAG=' '${dir}/.env'; then sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=${imageTag}|' '${dir}/.env'; else echo 'IMAGE_TAG=${imageTag}' >> '${dir}/.env'; fi`;
  await sshExec(host, 'root',
    `${setLine} && cd '${dir}' && docker compose -f docker-compose.prod.yml --env-file .env pull && docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans`,
    { sshKeyPath, timeoutMs: 600_000 });
}

// SSH into the Droplet and curl localhost:3000/api/health. Bypasses Caddy
// + LE cert entirely so we prove the app container itself is up. The
// direct-IP-via-HTTPS approach falls through to Caddy's default handler
// (Caddyfile only matches the configured domain, not the bare IP) so it
// doesn't actually test the app.
export async function pollHealthViaSsh(host, sshKeyPath, timeoutMs = 180_000) {
  step('ssh-deploy', `health check via ssh curl localhost:3000/api/health on ${host}`);
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
