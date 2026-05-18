// scripts/lib/github.mjs
//
// GitHub REST client. /deploy + /new-project use it for:
//   - Repo create from template (POST /repos/{owner}/{repo}/generate)
//   - Repo + environment secrets (libsodium sealed-box encrypted)
//   - Environment creation
//   - Branch protection ruleset
//   - Actions workflow dispatch (for /promote)
//
// Token scope expected: PAT with `repo` + `workflow` scopes. For org repos
// the operator may use Actions secrets instead; the deploy skill calls this
// out.

import { step } from './log.mjs';

const API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function call(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers || {}) },
  });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = body && body.message ? body.message : `HTTP ${r.status}`;
    throw new Error(`GH ${init.method || 'GET'} ${path} -> ${r.status}: ${msg}`);
  }
  return body;
}

export async function validateToken(token) {
  // PATs hit /user successfully. The runner's auto-generated GITHUB_TOKEN
  // (installation token) returns 403 -- it's not a user identity, and it
  // lacks the admin:write / secrets:write permissions deploy.mjs needs
  // downstream anyway. Fail fast with the exact remediation.
  try {
    return await call(token, '/user');
  } catch (e) {
    if (String(e.message).includes('403')) {
      throw new Error(
        'GH token is the runner\'s default GITHUB_TOKEN (installation token, ' +
        'no /user access, no admin write). Set the GH_AUTOMATION_TOKEN repo ' +
        'secret to a fine-grained PAT with: contents r/w, administration r/w, ' +
        'secrets r/w, actions r/w, workflows. See .claude/skills/first-fork.'
      );
    }
    throw e;
  }
}

// Repo create from template -------------------------------------------------

export async function createRepoFromTemplate(token, { templateOwner, templateRepo, owner, name, description, isPrivate = true }) {
  step('gh', `creating ${owner}/${name} from template ${templateOwner}/${templateRepo}`);
  return call(token, `/repos/${templateOwner}/${templateRepo}/generate`, {
    method: 'POST',
    body: JSON.stringify({
      owner,
      name,
      description: description || '',
      private: isPrivate,
      include_all_branches: false,
    }),
  });
}

export async function waitForRepoReady(token, owner, name, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await call(token, `/repos/${owner}/${name}`);
      if (r && r.default_branch) return r;
    } catch (e) {
      if (!String(e.message).includes('404')) throw e;
    }
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error(`repo ${owner}/${name} did not become ready in ${timeoutMs}ms`);
}

// Secret encryption (sealed box) --------------------------------------------

let _sodium;
async function sodium() {
  if (_sodium) return _sodium;
  try {
    const mod = await import('libsodium-wrappers');
    await mod.default.ready;
    _sodium = mod.default;
    return _sodium;
  } catch {
    throw new Error(
      'libsodium-wrappers not installed. Run `npm install` (it is a devDep) or pass --skip-secrets to use the GitHub UI manually.'
    );
  }
}

async function encrypt(publicKeyB64, value) {
  const s = await sodium();
  const key = s.from_base64(publicKeyB64, s.base64_variants.ORIGINAL);
  const bytes = s.from_string(value);
  const sealed = s.crypto_box_seal(bytes, key);
  return s.to_base64(sealed, s.base64_variants.ORIGINAL);
}

// Repo secrets ---------------------------------------------------------------

export async function getRepoPublicKey(token, owner, repo) {
  return call(token, `/repos/${owner}/${repo}/actions/secrets/public-key`);
}

export async function setRepoSecret(token, owner, repo, name, value) {
  const pk = await getRepoPublicKey(token, owner, repo);
  const encrypted_value = await encrypt(pk.key, value);
  await call(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
  });
}

export async function setManyRepoSecrets(token, owner, repo, map) {
  // Fetch the public key once, then encrypt + PUT each.
  const pk = await getRepoPublicKey(token, owner, repo);
  const names = [];
  for (const [name, value] of Object.entries(map)) {
    if (value == null || value === '') continue;
    const encrypted_value = await encrypt(pk.key, String(value));
    await call(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
    });
    names.push(name);
  }
  return names;
}

// Environment + env secrets --------------------------------------------------

export async function ensureEnvironment(token, owner, repo, envName) {
  step('gh', `ensuring environment ${envName}`);
  await call(token, `/repos/${owner}/${repo}/environments/${envName}`, {
    method: 'PUT',
    body: JSON.stringify({
      wait_timer: 0,
      reviewers: [],
      deployment_branch_policy: null,
    }),
  });
}

export async function getEnvPublicKey(token, owner, repo, envName) {
  return call(token, `/repos/${owner}/${repo}/environments/${envName}/secrets/public-key`);
}

export async function setManyEnvSecrets(token, owner, repo, envName, map) {
  const pk = await getEnvPublicKey(token, owner, repo, envName);
  const names = [];
  for (const [name, value] of Object.entries(map)) {
    if (value == null || value === '') continue;
    const encrypted_value = await encrypt(pk.key, String(value));
    await call(token, `/repos/${owner}/${repo}/environments/${envName}/secrets/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
    });
    names.push(name);
  }
  return names;
}

// Branch protection ruleset --------------------------------------------------

export async function ensureMainRuleset(token, owner, repo) {
  step('gh', `applying main branch protection ruleset`);
  const existing = await call(token, `/repos/${owner}/${repo}/rulesets`);
  const found = (existing || []).find(r => r.name === 'main-protection');
  const payload = {
    name: 'main-protection',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    rules: [
      { type: 'pull_request', parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
      { type: 'required_status_checks', parameters: {
        required_status_checks: [
          { context: 'Verify' },
          { context: 'Secrets scan' },
          { context: 'SAST' },
        ],
        strict_required_status_checks_policy: false,
      }},
      { type: 'deletion' },
      { type: 'non_fast_forward' },
    ],
  };
  if (found) {
    await call(token, `/repos/${owner}/${repo}/rulesets/${found.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } else {
    await call(token, `/repos/${owner}/${repo}/rulesets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

// Workflow dispatch (used by /promote) --------------------------------------

export async function dispatchWorkflow(token, owner, repo, workflowFile, ref, inputs = {}) {
  return call(token, `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
}

export async function listWorkflowRuns(token, owner, repo, workflowFile, branch) {
  const q = branch ? `?branch=${encodeURIComponent(branch)}&per_page=10` : '?per_page=10';
  return call(token, `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs${q}`);
}

// Tags + releases ------------------------------------------------------------

export async function createTag(token, owner, repo, tag, sha) {
  await call(token, `/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
}

// Repo details ---------------------------------------------------------------

export async function getRepo(token, owner, repo) {
  return call(token, `/repos/${owner}/${repo}`);
}

export async function getLatestCommitSha(token, owner, repo, branch) {
  const r = await call(token, `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`);
  return r.sha;
}
