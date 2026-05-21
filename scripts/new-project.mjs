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
if (!apex || apex.length < 4) {
  bail(P, "apex is required (e.g. ops-rihal.com)");
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
if (!CF_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
if (missing.length) bail(P, `missing env: ${missing.join(", ")}`);

const teamQs = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : "";
const customDomain = `${slug}.${apex}`;

const authSecret = randomBytes(32).toString("base64");
const seedAdminPassword = randomBytes(18)
  .toString("base64")
  .replace(/[+/=]/g, (c) => ({ "+": "A", "/": "B", "=": "" })[c]);

async function api(label, url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.text();
    bail(P, `${label} failed: HTTP ${r.status} -- ${body.slice(0, 400)}`);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
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
  }
);
ok(P, `GH repo: ${ghRepo.html_url} (id ${ghRepo.id})`);

// 2. Neon: create project, derive pooled connection string
let neonOrgId = process.env.NEON_ORG_ID || "";
if (!neonOrgId) {
  step(P, "Looking up Neon organization...");
  const orgs = await api(
    "Neon orgs list",
    "https://console.neon.tech/api/v2/users/me/organizations",
    {
      headers: { Authorization: `Bearer ${NEON_KEY}`, Accept: "application/json" },
    }
  );
  const orgList = orgs.organizations || [];
  if (orgList.length === 0) {
    bail(P, "Neon API returned no organizations. Set NEON_ORG_ID as a repo variable.");
  }
  if (orgList.length > 1) {
    const names = orgList.map((o) => `${o.name} (${o.id})`).join(", ");
    bail(P, `Multiple Neon orgs found: ${names}. Set NEON_ORG_ID as a repo variable.`);
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

const cu = neon.connection_uris?.[0];
if (!cu?.connection_parameters?.pooler_host) {
  bail(P, `Neon response missing pooler_host; got: ${JSON.stringify(neon).slice(0, 400)}`);
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
        { key: "SEED_ADMIN_PASSWORD", value: seedAdminPassword, target: envTargets, type: "encrypted" },
      ],
    }),
  }
);
ok(P, `Vercel project: ${vercelProject.id} (${vercelProject.name})`);

// 4. Cloudflare: zone lookup + CNAME create
step(P, `Looking up Cloudflare zone for ${apex}...`);
const zoneData = await api(
  "CF zone lookup",
  `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`,
  { headers: { Authorization: `Bearer ${CF_TOKEN}` } }
);
const zoneId = zoneData.result?.[0]?.id;
if (!zoneId) bail(P, `Cloudflare zone not found: ${apex}`);
ok(P, `CF zone: ${zoneId}`);

step(P, `Creating CNAME ${customDomain} -> cname.vercel-dns.com...`);
try {
  await api("CF DNS create", `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "CNAME",
      name: slug,
      content: "cname.vercel-dns.com",
      proxied: false,
      ttl: 1,
      comment: `${displayName} (created by new-project workflow)`,
    }),
  });
  ok(P, `CF CNAME: ${customDomain} -> cname.vercel-dns.com (proxied: off)`);
} catch (e) {
  warn(P, `CF CNAME create failed; the record may already exist. Continuing. (${e.message})`);
}

// 5. Vercel: attach custom domain to the project
step(P, `Adding ${customDomain} to Vercel project...`);
try {
  await api(
    "Vercel domain add",
    `https://api.vercel.com/v10/projects/${vercelProject.id}/domains${teamQs}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: customDomain }),
    }
  );
  ok(P, `Vercel domain: ${customDomain} (TLS issuance is automatic once DNS propagates)`);
} catch (e) {
  warn(P, `Vercel domain add failed; visit the project's Domains tab to add manually. (${e.message})`);
}

// 6. Trigger first production deployment
step(P, `Triggering first production deploy...`);
try {
  const deploy = await api(
    "Vercel deploy",
    `https://api.vercel.com/v13/deployments${teamQs}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: slug,
        project: vercelProject.id,
        target: "production",
        gitSource: { type: "github", ref: "main", repoId: ghRepo.id },
      }),
    }
  );
  ok(P, `Deploy queued: https://${deploy.url}`);
} catch (e) {
  warn(P, `Auto-deploy trigger failed; Vercel typically deploys on first push anyway. (${e.message})`);
}

// 7. Operator-facing summary
const summary = [
  "",
  "## New project provisioned",
  "",
  `- **GitHub repo:** ${ghRepo.html_url}`,
  `- **Vercel project:** https://vercel.com/dashboard (id \`${vercelProject.id}\`)`,
  `- **Neon project:** https://console.neon.tech/app/projects/${neon.project.id}`,
  `- **Production URL:** https://${customDomain} (TLS issuance can take 1-2 min after CF DNS propagates)`,
  `- **Vercel preview URL:** https://${slug}.vercel.app (active immediately)`,
  "",
  "## Seeded admin credentials (rotate after first login)",
  "",
  `- **Email:** \`${adminEmail}\``,
  `- **Password:** \`${seedAdminPassword}\``,
  "",
  "## Next steps",
  "",
  "1. Wait ~2 minutes for the first build to finish (Vercel runs migrate + seed automatically).",
  `2. Open ${customDomain} and log in with the credentials above.`,
  `3. Start a Claude Code session on \`${owner}/${slug}\` and type \`/quickstart "<your idea>"\` to scaffold features.`,
  "",
].join("\n");

console.log(summary);
ok(P, "All steps completed.");
