#!/usr/bin/env node
// scripts/new-project.mjs
//
// One-shot provisioner for a brand-new prototype on the Vercel + Neon rail.
// Triggered via .github/workflows/new-project.yml (workflow_dispatch).
//
// Steps:
//   1. Create a GitHub repo from this template via the GitHub generate API.
//   2. Create a Neon Postgres project; capture the pooled connection string.
//   3. Create a Vercel project linked to the new GitHub repo; set 5 env vars.
//   4. Create a Cloudflare CNAME record (<slug>.<apex> -> cname.vercel-dns.com).
//   5. Add the custom domain to the Vercel project so Vercel issues TLS.
//   6. Trigger the first production deployment.
//
// Operator-facing output is appended to $GITHUB_STEP_SUMMARY by the workflow,
// so the new repo URL, Vercel URL, custom URL, and seeded admin credentials
// all surface in the GitHub Actions run summary.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { step, ok, warn, bail } from "./lib/log.mjs";

const P = "new-project";

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    "display-name": { type: "string" },
    "admin-email": { type: "string" },
    apex: { type: "string" },
    owner: { type: "string" },
    "neon-region": { type: "string", default: "aws-eu-central-1" },
    "template-owner": { type: "string", default: "Tariq-AlNuaimi" },
    "template-repo": { type: "string", default: "fullstack-vibe-template" },
  },
});

const slug = values.slug;
const displayName = values["display-name"] || slug;
const adminEmail = values["admin-email"];
const apex = values.apex;
const owner = values.owner;
const neonRegion = values["neon-region"];
const templateOwner = values["template-owner"];
const templateRepo = values["template-repo"];

if (!slug || !/^[a-z][a-z0-9-]{1,38}$/.test(slug)) {
  bail(P, `slug must match /^[a-z][a-z0-9-]{1,38}$/ (got: ${JSON.stringify(slug)})`);
}
if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
  bail(P, "admin-email is required and must look like an email");
}
if (apex && apex.length < 4) {
  bail(P, "--apex, when set, must be a domain you control in Cloudflare (e.g. ops-rihal.com)");
}
if (!owner) {
  bail(P, "owner is required (GitHub user or org that will hold the new repo)");
}

const GH_TOKEN = process.env.GH_AUTOMATION_TOKEN;
const NEON_KEY = process.env.NEON_API_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const missing = [];
if (!GH_TOKEN) missing.push("GH_AUTOMATION_TOKEN");
if (!NEON_KEY) missing.push("NEON_API_KEY");
if (!VERCEL_TOKEN) missing.push("VERCEL_TOKEN");
if (apex && !CF_TOKEN) missing.push("CLOUDFLARE_API_TOKEN (required for --apex)");
if (missing.length) {
  bail(
    P,
    `Missing required token env var(s): ${missing.join(", ")}.\n` +
      "  This is a CREDENTIALS problem (not a network/egress block) -- set the\n" +
      "  token(s) as environment variables, then re-run. Where to mint them:\n" +
      "    - GH_AUTOMATION_TOKEN -> GitHub PAT, scopes repo + workflow\n" +
      "    - NEON_API_KEY        -> https://console.neon.tech/app/settings/api-keys\n" +
      "    - VERCEL_TOKEN        -> https://vercel.com/account/tokens\n" +
      "    - CLOUDFLARE_API_TOKEN-> only for --apex (Zone.DNS:Edit on the apex zone)\n" +
      "  (Egress to the provider hosts is checked separately by the preflight below.)",
  );
}

const teamQs = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : "";
const customDomain = apex ? `${slug}.${apex}` : null;

// ---------------------------------------------------------------------------
// Rollback bookkeeping.
//
// This script creates resources across three providers in sequence (GitHub
// repo -> Neon project -> Vercel project). A failure partway through (e.g. the
// Vercel create failing after the repo + Neon project already exist) would
// otherwise orphan everything created so far. We record each id as it's
// created, and `teardown()` makes a best-effort attempt to delete them
// (reverse order) before exiting non-zero, printing exactly what was and
// wasn't cleaned up. Teardown never throws -- a failed delete is reported so
// the operator gets the complete picture.
// ---------------------------------------------------------------------------
const created = { repoFullName: null, neonProjectId: null, vercelProjectId: null };

async function teardown() {
  const left = [];
  // Best-effort DELETE of one provisioned resource; identical message shape for each.
  const del = async (id, label, url, headers) => {
    if (!id) return;
    step(P, `Rolling back: deleting ${label} ${id}...`);
    try {
      const r = await fetch(url, { method: "DELETE", headers });
      if (r.ok || r.status === 404) ok(P, `Rolled back ${label} ${id}.`);
      else {
        left.push(`${label} ${id} (HTTP ${r.status})`);
        warn(P, `Could not delete ${label} ${id} (HTTP ${r.status}).`);
      }
    } catch (e) {
      left.push(`${label} ${id} (${e.message})`);
      warn(P, `Could not delete ${label} ${id}: ${e.message}`);
    }
  };
  // Vercel (holds env vars + git link) -> Neon (the database) -> GitHub repo.
  await del(
    created.vercelProjectId,
    "Vercel project",
    `https://api.vercel.com/v9/projects/${created.vercelProjectId}${teamQs}`,
    { Authorization: `Bearer ${VERCEL_TOKEN}` },
  );
  await del(
    created.neonProjectId,
    "Neon project",
    `https://console.neon.tech/api/v2/projects/${created.neonProjectId}`,
    { Authorization: `Bearer ${NEON_KEY}`, Accept: "application/json" },
  );
  if (created.repoFullName) {
    step(P, `Rolling back: deleting GitHub repo ${created.repoFullName}...`);
    try {
      const r = await fetch(`https://api.github.com/repos/${created.repoFullName}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (r.ok || r.status === 404) ok(P, `Rolled back GitHub repo ${created.repoFullName}.`);
      else {
        left.push(
          `GitHub repo ${created.repoFullName} (HTTP ${r.status}${r.status === 403 ? "; token needs delete_repo scope" : ""})`,
        );
        warn(P, `Could not delete GitHub repo ${created.repoFullName} (HTTP ${r.status}).`);
      }
    } catch (e) {
      left.push(`GitHub repo ${created.repoFullName} (${e.message})`);
      warn(P, `Could not delete GitHub repo ${created.repoFullName}: ${e.message}`);
    }
  }
  if (left.length) {
    warn(P, `Manual cleanup still required for: ${left.join("; ")}`);
  } else if (created.repoFullName || created.neonProjectId || created.vercelProjectId) {
    ok(P, "Rollback complete -- no orphaned resources left behind.");
  }
}

// bailWithRollback: best-effort teardown, then exit non-zero. Use for any
// failure that can occur AFTER a resource has been created; pre-creation
// validation keeps using plain bail() (nothing to clean up yet).
async function bailWithRollback(msg) {
  await teardown();
  bail(P, msg);
}

const authSecret = randomBytes(32).toString("base64");
// Audit-retention cron secret (ADR-018): without it the daily audit-purge cron
// shipped in vercel.json no-ops (200 {skipped:true}) forever. Must be set on the
// project BEFORE the first build, same as /deploy. >=32 chars per lib/env.ts.
const cronSecret = randomBytes(32).toString("base64");
const seedAdminPassword = randomBytes(18)
  .toString("base64")
  .replace(/[+/=]/g, (c) => ({ "+": "A", "/": "B", "=": "" })[c]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(label, url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.text();
    // Any HTTP failure here may come AFTER a resource was created, so roll back
    // before exiting. teardown() only touches ids that were actually recorded.
    await bailWithRollback(`${label} failed: HTTP ${r.status} -- ${body.slice(0, 400)}`);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}

// apiTry: like api(), but THROWS on an HTTP error instead of exiting. Used by
// the optional, intentionally-non-fatal steps (CF DNS, domain attach, deploy
// trigger) so their existing try/catch keeps treating a failure as a warning
// and the run still succeeds -- no rollback for those (everything is already
// provisioned). Keeps the happy-path response handling identical to api().
async function apiTry(label, url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`${label} failed: HTTP ${r.status} -- ${body.slice(0, 400)}`);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}

// 0. Preflight -- is egress to the provider APIs allowed? In a Claude Code web
// session, outbound is governed by an allowlist proxy; blocked hosts answer
// HTTP 403 with `x-deny-reason: host_not_allowed`, or the socket never
// connects. Probe first so the failure is one clear, actionable message rather
// than a mid-run crash after a repo has already been created.
const egressHosts = [
  "https://api.github.com",
  "https://api.vercel.com/v2/user",
  "https://console.neon.tech/api/v2/users/me",
];
if (apex) egressHosts.push("https://api.cloudflare.com/client/v4/user");

step(P, "Preflight: checking egress to provider APIs...");
{
  // Probe hosts concurrently (independent GETs); filter preserves egressHosts order.
  const probes = await Promise.all(
    egressHosts.map(async (url) => {
      const host = new URL(url).host;
      try {
        const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
        return r.headers.get("x-deny-reason") ? host : null;
      } catch {
        return host;
      }
    }),
  );
  const blocked = probes.filter(Boolean);
  if (blocked.length) {
    const hosts = [
      "api.github.com",
      "api.vercel.com",
      "console.neon.tech",
      ...(apex ? ["api.cloudflare.com (for the custom domain)"] : []),
      "*.neon.tech (port 5432, only to seed from the session)",
    ];
    bail(
      P,
      "Egress to the provider APIs is blocked by this environment's network " +
        `policy (blocked: ${blocked.join(", ")}).\n` +
        "  This is NOT a credentials problem -- API tokens cannot bypass the proxy.\n" +
        "  Fix: configure the Claude Code web environment with a network policy\n" +
        "  that allows these hosts, then re-run:\n" +
        hosts.map((h) => `    - ${h}`).join("\n") +
        "\n  Docs: https://code.claude.com/docs/en/claude-code-on-the-web\n" +
        "  (Or run this from a machine with open egress and the tokens set.)",
    );
  }
  ok(P, "Egress OK.");
}

// 1. GitHub: create repo from template
step(P, `Creating GitHub repo ${owner}/${slug} from ${templateOwner}/${templateRepo}...`);
const ghRepo = await api(
  "GitHub repo create",
  `https://api.github.com/repos/${templateOwner}/${templateRepo}/generate`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      owner,
      name: slug,
      description: displayName,
      private: true,
      include_all_branches: false,
    }),
  },
);
// Record the repo so a later failure (Neon/Vercel create) rolls it back.
// Deleting a repo requires the token to carry the delete_repo scope; if it
// doesn't, teardown reports the repo as left-behind rather than failing.
created.repoFullName = ghRepo.full_name || `${owner}/${slug}`;
ok(P, `GH repo: ${ghRepo.html_url} (id ${ghRepo.id})`);

// 1b. Stamp out the pristine-template marker in the generated repo so its first
// `npm run ship` is gated by the ADR-031 db-structure domain-model check instead
// of staying silently exempt (findings-register 2026-07-02). The generate API
// copies project.config.json verbatim -- including "pristine": true -- so we flip
// it to false via a single contents commit. Best-effort: a failure here never
// fails provisioning (the operator can /rebrand, which also clears it, or set it
// manually before /ship).
try {
  const branch = ghRepo.default_branch || "main";
  const ghHeaders = {
    Authorization: `Bearer ${GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const cur = await apiTry(
    "GitHub read project.config.json",
    `https://api.github.com/repos/${created.repoFullName}/contents/project.config.json?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders },
  );
  const decoded = Buffer.from(cur.content || "", cur.encoding || "base64").toString("utf8");
  if (/"pristine":\s*true/.test(decoded)) {
    const updated = decoded.replace(/"pristine":\s*true/, '"pristine": false');
    await apiTry(
      "GitHub stamp pristine flag",
      `https://api.github.com/repos/${created.repoFullName}/contents/project.config.json`,
      {
        method: "PUT",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "chore: clear pristine-template flag (fork gated by ADR-031 db-structure check)",
          content: Buffer.from(updated, "utf8").toString("base64"),
          sha: cur.sha,
          branch,
        }),
      },
    );
    ok(
      P,
      "Cleared pristine-template flag in the new repo (ADR-031 db-structure gate now applies).",
    );
  }
} catch (e) {
  warn(
    P,
    `Could not clear pristine flag in the new repo: ${e.message}. Run /rebrand (clears it) or set "pristine": false in project.config.json before /ship.`,
  );
}

// 2. Neon: create project, derive pooled connection string
let neonOrgId = process.env.NEON_ORG_ID || "";
if (!neonOrgId) {
  step(P, "Looking up Neon organization...");
  const orgs = await api(
    "Neon orgs list",
    "https://console.neon.tech/api/v2/users/me/organizations",
    {
      headers: { Authorization: `Bearer ${NEON_KEY}`, Accept: "application/json" },
    },
  );
  const orgList = orgs.organizations || [];
  if (orgList.length === 0) {
    // The GitHub repo already exists by now, so roll it back rather than orphan it.
    await bailWithRollback(
      "Neon API returned no organizations. Set NEON_ORG_ID as a repo variable.",
    );
  }
  if (orgList.length > 1) {
    const names = orgList.map((o) => `${o.name} (${o.id})`).join(", ");
    await bailWithRollback(
      `Multiple Neon orgs found: ${names}. Set NEON_ORG_ID as a repo variable.`,
    );
  }
  neonOrgId = orgList[0].id;
  ok(P, `Neon org: ${orgList[0].name} (${neonOrgId})`);
}

step(P, `Creating Neon project (${neonRegion})...`);
const neon = await api("Neon project create", "https://console.neon.tech/api/v2/projects", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${NEON_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    project: { name: slug, region_id: neonRegion, pg_version: 17, org_id: neonOrgId },
  }),
});

// Record the Neon project id the moment it exists so any later failure (incl.
// the pooler_host check just below, or the Vercel create) rolls it back.
created.neonProjectId = neon.project?.id ?? null;
const cu = neon.connection_uris?.[0];
if (!cu?.connection_parameters?.pooler_host) {
  await bailWithRollback(
    `Neon response missing pooler_host; got: ${JSON.stringify(neon).slice(0, 400)}`,
  );
}
const cp = cu.connection_parameters;
const databaseUrl = `postgresql://${cp.role}:${cp.password}@${cp.pooler_host}/${cp.database}?sslmode=require&channel_binding=require`;
ok(P, `Neon project: ${neon.project.id} (endpoint ${cp.endpoint_id})`);

// 3. Vercel: create project linked to the new GH repo with env vars baked in
step(P, `Creating Vercel project linked to ${owner}/${slug}...`);
const envTargets = ["production", "preview", "development"];
const vercelProject = await api(
  "Vercel project create",
  `https://api.vercel.com/v11/projects${teamQs}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: slug,
      framework: "nextjs",
      gitRepository: { type: "github", repo: `${owner}/${slug}` },
      environmentVariables: [
        { key: "DATABASE_URL", value: databaseUrl, target: envTargets, type: "encrypted" },
        { key: "AUTH_SECRET", value: authSecret, target: envTargets, type: "encrypted" },
        { key: "NEXT_PUBLIC_APP_NAME", value: displayName, target: envTargets, type: "plain" },
        { key: "SEED_ADMIN_EMAIL", value: adminEmail, target: envTargets, type: "plain" },
        {
          key: "SEED_ADMIN_PASSWORD",
          value: seedAdminPassword,
          target: envTargets,
          type: "encrypted",
        },
        { key: "CRON_SECRET", value: cronSecret, target: envTargets, type: "encrypted" },
      ],
    }),
  },
);
// Record so a later fatal step would roll the Vercel project back too. The
// remaining steps (CF DNS, domain attach, deploy trigger) are non-fatal (they
// only warn), so by this point provisioning is effectively done.
created.vercelProjectId = vercelProject.id ?? null;
ok(P, `Vercel project: ${vercelProject.id} (${vercelProject.name})`);

// 3b. Confirm all env vars are visible on the project BEFORE the first deploy
// (#50). Mirrors scripts/deploy.mjs: a first build that runs before CRON_SECRET /
// the SEED_ADMIN_* vars land bakes in a permanently dead audit-purge cron and
// seeds no admin. Poll the env list, and only proceed once all six keys exist.
const expectedEnvKeys = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "NEXT_PUBLIC_APP_NAME",
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PASSWORD",
  "CRON_SECRET",
];
step(P, "Verifying all env vars are set on the project before deploying...");
let envConfirmed = false;
let lastMissing = expectedEnvKeys;
for (let attempt = 1; attempt <= 5 && !envConfirmed; attempt++) {
  let present = [];
  try {
    const envList = await apiTry(
      "Vercel env list",
      `https://api.vercel.com/v9/projects/${vercelProject.id}/env${teamQs}`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } },
    );
    present = (envList.envs || []).map((e) => e.key);
  } catch (e) {
    warn(P, `Env list read failed (attempt ${attempt}/5): ${e.message}`);
  }
  lastMissing = expectedEnvKeys.filter((k) => !present.includes(k));
  if (lastMissing.length === 0) {
    envConfirmed = true;
    break;
  }
  if (attempt < 5) {
    warn(
      P,
      `Env not fully propagated yet (missing: ${lastMissing.join(", ")}); retrying in ${attempt * 2}s...`,
    );
    await sleep(attempt * 2000);
  }
}
if (!envConfirmed) {
  await bailWithRollback(
    `Env vars did not propagate to the Vercel project after 5 attempts ` +
      `(still missing: ${lastMissing.join(", ")}). Aborting BEFORE deploy so we ` +
      `don't ship a first build that can't see CRON_SECRET / SEED_ADMIN_* ` +
      `(dead cron + no admin user).`,
  );
}
ok(P, `All ${expectedEnvKeys.length} env vars confirmed on the project.`);

// 4-5. Cloudflare CNAME + attach custom domain to the project (only with --apex)
if (apex) {
  step(P, `Looking up Cloudflare zone for ${apex}...`);
  const zoneData = await api(
    "CF zone lookup",
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`,
    { headers: { Authorization: `Bearer ${CF_TOKEN}` } },
  );
  const zoneId = zoneData.result?.[0]?.id;
  if (!zoneId) await bailWithRollback(`Cloudflare zone not found: ${apex}`);
  ok(P, `CF zone: ${zoneId}`);

  step(P, `Creating CNAME ${customDomain} -> cname.vercel-dns.com...`);
  try {
    await apiTry(
      "CF DNS create",
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "CNAME",
          name: slug,
          content: "cname.vercel-dns.com",
          proxied: false,
          ttl: 1,
          comment: `${displayName} (created by new-project)`,
        }),
      },
    );
    ok(P, `CF CNAME: ${customDomain} -> cname.vercel-dns.com (proxied: off)`);
  } catch (e) {
    warn(P, `CF CNAME create failed; the record may already exist. Continuing. (${e.message})`);
  }

  step(P, `Adding ${customDomain} to Vercel project...`);
  try {
    await apiTry(
      "Vercel domain add",
      `https://api.vercel.com/v10/projects/${vercelProject.id}/domains${teamQs}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: customDomain }),
      },
    );
    ok(P, `Vercel domain: ${customDomain} (TLS issuance is automatic once DNS propagates)`);
  } catch (e) {
    warn(
      P,
      `Vercel domain add failed; visit the project's Domains tab to add manually. (${e.message})`,
    );
  }
}

// 6. Trigger first production deployment
step(P, `Triggering first production deploy...`);
try {
  const deploy = await apiTry("Vercel deploy", `https://api.vercel.com/v13/deployments${teamQs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: slug,
      project: vercelProject.id,
      target: "production",
      gitSource: { type: "github", ref: "main", repoId: ghRepo.id },
    }),
  });
  ok(P, `Deploy queued: https://${deploy.url}`);
} catch (e) {
  warn(
    P,
    `Auto-deploy trigger failed; Vercel typically deploys on first push anyway. (${e.message})`,
  );
}

// 7. Operator-facing summary
const summary = [
  "",
  "## New project provisioned",
  "",
  `- **GitHub repo:** ${ghRepo.html_url}`,
  `- **Vercel project:** https://vercel.com/dashboard (id \`${vercelProject.id}\`)`,
  `- **Neon project:** https://console.neon.tech/app/projects/${neon.project.id}`,
  ...(customDomain
    ? [
        `- **Production URL:** https://${customDomain} (TLS can take 1-2 min after CF DNS propagates)`,
      ]
    : []),
  `- **Vercel URL:** https://${slug}.vercel.app (active once the first build finishes)`,
  "",
  "## Seeded admin credentials (rotate after first login)",
  "",
  `- **Email:** \`${adminEmail}\``,
  `- **Password:** \`${seedAdminPassword}\``,
  "",
  "## Next steps",
  "",
  "1. Wait ~2 minutes for the first build to finish (Vercel runs migrate + seed automatically).",
  `2. Open ${customDomain ?? `${slug}.vercel.app`} and log in with the credentials above.`,
  `3. Start a Claude Code session on \`${owner}/${slug}\` and type \`/quickstart "<your idea>"\` to scaffold features.`,
  "",
].join("\n");

console.log(summary);
ok(P, "All steps completed.");
