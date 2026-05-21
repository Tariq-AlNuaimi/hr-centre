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

import { createRequire } from 'node:module';
import { step } from './log.mjs';

const API = 'https://api.github.com';

// libsodium-wrappers@0.7.x ships a broken ESM build (its modules-esm/
// libsodium-wrappers.mjs imports './libsodium.mjs' which doesn't exist in
// the npm tarball -- only libsodium.js does). Forcing CommonJS load via
// createRequire is the documented workaround and matches what every other
// GitHub Actions setup-secret reference implementation does.
const requireSodium = createRequire(import.meta.url);

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function call(token, path, init = {}, attempt = 1) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init.headers || {}) },
  });
  // GitHub's secrets / variables / rulesets APIs occasionally return 5xx
  // during their internal partial-outages (operator hit AUTH_SECRET PUT
  // returning 503 "Secrets service unavailable" mid-deploy). Retry with
  // exponential backoff -- secrets PUTs are idempotent so a re-issue is
  // safe. Also retry on 429 (rate limit) with Retry-After if present.
  if ((r.status === 429 || r.status >= 500) && attempt <= 4) {
    const retryAfter = Number(r.headers.get('Retry-After') || 0);
    const backoffMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 16_000);
    await new Promise(res => setTimeout(res, backoffMs));
    return call(token, path, init, attempt + 1);
  }
  if (r.status === 204) return null;
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = body && body.message ? body.message : `HTTP ${r.status}`;
    throw new Error(`GH ${init.method || 'GET'} ${path} -> ${r.status}: ${msg}`);
  }
  return body;
}

export async function validateToken(token, { owner, repo } = {}) {
  // PATs hit /user successfully. The runner's auto-generated GITHUB_TOKEN
  // (installation token) returns 403 -- it's not a user identity, and it
  // lacks the admin:write / secrets:write permissions deploy.mjs needs
  // downstream anyway. Fail fast with the exact remediation.
  let user;
  try {
    user = await call(token, '/user');
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
  // Probe secrets:write scope upfront so we fail fast (LOW #8). Skipped if
  // caller didn't pass owner/repo (e.g. /new-project before the target repo
  // exists).
  if (owner && repo) {
    try {
      await call(token, `/repos/${owner}/${repo}/actions/secrets/public-key`);
    } catch (e) {
      if (String(e.message).includes('403')) {
        throw new Error(
          'GH PAT validated as user but lacks `Repository:Secrets:write` scope; ' +
          'required to set deploy secrets.'
        );
      }
      throw e;
    }
  }
  return user;
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
    // CJS load via createRequire -- the ESM entry point in 0.7.x is broken.
    const mod = requireSodium('libsodium-wrappers');
    await mod.ready;
    _sodium = mod;
    return _sodium;
  } catch (e) {
    throw new Error(
      `libsodium-wrappers load failed: ${e && e.message ? e.message : String(e)}. ` +
      'It is a runtime dep. Run `npm install` or rebuild the runner image.'
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
  // Fetch the public key once, then encrypt + PUT each in parallel.
  // GH's secrets-write API has no per-repo rate limit at this scale (we ship
  // ~12 secrets per deploy), and Promise.all over fetch is a few-seconds win
  // on the deploy critical path.
  const pk = await getRepoPublicKey(token, owner, repo);
  const entries = Object.entries(map).filter(([, v]) => v != null && v !== '');
  await Promise.all(entries.map(async ([name, value]) => {
    const encrypted_value = await encrypt(pk.key, String(value));
    await call(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
    });
  }));
  return entries.map(([n]) => n);
}

// Environment + env secrets --------------------------------------------------

export async function ensureEnvironment(token, owner, repo, envName) {
  step('gh', `ensuring environment ${envName}`);
  // Protection-rule fields (`reviewers`, `wait_timer`, `prevent_self_review`)
  // are paid-plan-only on private repos; sending any of them returns
  // 422 "Failed to create the environment protection rule". Send an
  // empty body to create/upsert the environment without gates.
  // Operators who need reviewer / wait-timer gates re-add them in the
  // GH UI on a paid plan -- the env itself exists either way.
  await call(token, `/repos/${owner}/${repo}/environments/${envName}`, {
    method: 'PUT',
    body: JSON.stringify({
      deployment_branch_policy: null,
    }),
  });
}

export async function getEnvPublicKey(token, owner, repo, envName) {
  return call(token, `/repos/${owner}/${repo}/environments/${envName}/secrets/public-key`);
}

export async function setManyEnvSecrets(token, owner, repo, envName, map) {
  // Parallel PUTs after one pubkey fetch -- same rationale as setManyRepoSecrets.
  const pk = await getEnvPublicKey(token, owner, repo, envName);
  const entries = Object.entries(map).filter(([, v]) => v != null && v !== '');
  await Promise.all(entries.map(async ([name, value]) => {
    const encrypted_value = await encrypt(pk.key, String(value));
    await call(token, `/repos/${owner}/${repo}/environments/${envName}/secrets/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value, key_id: pk.key_id }),
    });
  }));
  return entries.map(([n]) => n);
}

// Repo variables (non-secret, plaintext) ------------------------------------

export async function setRepoVariable(token, owner, repo, name, value) {
  // Variables API returns 404 if the variable does not yet exist; in that
  // case we POST to create, otherwise PATCH to update. Distinct from secrets
  // because variables are not encrypted (they're plaintext, e.g. CADDY_EMAIL).
  const existing = await fetch(`${API}/repos/${owner}/${repo}/actions/variables/${name}`, {
    headers: headers(token),
  });
  if (existing.status === 404) {
    await call(token, `/repos/${owner}/${repo}/actions/variables`, {
      method: 'POST',
      body: JSON.stringify({ name, value: String(value) }),
    });
  } else {
    await call(token, `/repos/${owner}/${repo}/actions/variables/${name}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, value: String(value) }),
    });
  }
}

export async function setManyRepoVariables(token, owner, repo, map) {
  const names = [];
  for (const [name, value] of Object.entries(map)) {
    if (value == null || value === '') continue;
    await setRepoVariable(token, owner, repo, name, value);
    names.push(name);
  }
  return names;
}

export async function setEnvVariable(token, owner, repo, envName, name, value) {
  // Same upsert pattern, scoped to a GitHub Environment. Used by
  // /new-project to land SENTRY_DSN on the fork's staging env so operators
  // can override per-project without touching the repo-level value.
  // The Environments-variables API is keyed by repo_id, not name, hence the
  // extra GET to resolve the id once.
  const repoMeta = await call(token, `/repos/${owner}/${repo}`);
  const repoId = repoMeta.id;
  const existing = await fetch(
    `${API}/repositories/${repoId}/environments/${envName}/variables/${name}`,
    { headers: headers(token) },
  );
  if (existing.status === 404) {
    await call(token, `/repositories/${repoId}/environments/${envName}/variables`, {
      method: 'POST',
      body: JSON.stringify({ name, value: String(value) }),
    });
  } else {
    await call(token, `/repositories/${repoId}/environments/${envName}/variables/${name}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, value: String(value) }),
    });
  }
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
