#!/usr/bin/env node
// scripts/deploy.mjs
//
// Provision + deploy the CURRENT repo to the Vercel + Neon rail, from anywhere
// with network egress to the provider APIs -- including a Claude Code web
// session (once the environment's network policy allows the hosts below).
//
// Unlike scripts/new-project.mjs (which creates a brand-new repo and is wired
// to run inside GitHub Actions), this script assumes the GitHub repo already
// exists (e.g. a fork you just built in), and:
//   1. Preflight: verify egress to the provider APIs; if blocked, print the
//      exact hosts to add to the environment's network policy and stop.
//   2. Create a Neon Postgres project; derive the pooled DATABASE_URL.
//   3. Create a Vercel project linked to <owner>/<slug>, with the 5 env vars.
//   4. (Optional, with --apex) Point a Cloudflare CNAME at Vercel and attach
//      the custom domain so Vercel issues TLS.
//   5. Trigger the first production deploy (uses the repoId Vercel returns from
//      the git link -- no GitHub token needed).
//   6. Print the URLs + seeded admin credentials to stdout.
//
// Required env: NEON_API_KEY, VERCEL_TOKEN
// Optional env: VERCEL_TEAM_ID, NEON_ORG_ID, CLOUDFLARE_API_TOKEN (for --apex)
//
//   node scripts/deploy.mjs --slug coo-update-dashboard \
//     --display-name "COO Update Dashboard" \
//     --owner tariq-alnuaimi --admin-email you@example.com \
//     [--apex example.com] [--subdomain coo]
//
// See .claude/skills/deploy/SKILL.md.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { step, ok, warn, bail } from "./lib/log.mjs";

const P = "deploy";

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    "display-name": { type: "string" },
    "admin-email": { type: "string" },
    owner: { type: "string" },
    "neon-region": { type: "string", default: "aws-eu-central-1" },
    ref: { type: "string", default: "main" },
    apex: { type: "string" },        // Cloudflare zone apex, e.g. example.com
    subdomain: { type: "string" },   // host label, defaults to the slug
  },
});

const slug = values.slug;
const displayName = values["display-name"] || slug;
const adminEmail = values["admin-email"];
const owner = values.owner;
const neonRegion = values["neon-region"];
const ref = values.ref;
const apex = values.apex;
const subdomain = values.subdomain || slug;

if (!slug || !/^[a-z][a-z0-9-]{1,38}$/.test(slug)) {
  bail(P, `--slug must match /^[a-z][a-z0-9-]{1,38}$/ (got: ${JSON.stringify(slug)})`);
}
if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
  bail(P, "--admin-email is required and must look like an email");
}
if (!owner) bail(P, "--owner is required (GitHub user/org that holds the repo)");
if (apex && apex.length < 4) bail(P, "--apex must be a domain you control in Cloudflare (e.g. example.com)");

const NEON_KEY = process.env.NEON_API_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const missing = [];
if (!NEON_KEY) missing.push("NEON_API_KEY");
if (!VERCEL_TOKEN) missing.push("VERCEL_TOKEN");
if (apex && !CF_TOKEN) missing.push("CLOUDFLARE_API_TOKEN (required for --apex)");
if (missing.length) {
  bail(
    P,
    `missing env: ${missing.join(", ")}. Set these as environment variables in ` +
      `your Claude Code web environment (or your shell), then re-run.`
  );
}

const teamQs = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : "";
const customDomain = apex ? `${subdomain}.${apex}` : null;

// ---------------------------------------------------------------------------
// 0. Preflight -- is egress to the provider APIs allowed?
//
// In a Claude Code web session the egress is governed by an allowlist proxy;
// blocked hosts return HTTP 403 with `x-deny-reason: host_not_allowed`, or the
// connection times out. We probe before doing any work so the failure is a
// clear, actionable message instead of a mid-run crash.
// ---------------------------------------------------------------------------
const egressHosts = [
  "https://api.vercel.com/v2/user",
  "https://console.neon.tech/api/v2/users/me",
];
if (apex) egressHosts.push("https://api.cloudflare.com/client/v4/user");

async function preflight() {
  step(P, "Preflight: checking egress to provider APIs...");
  const blocked = [];
  for (const url of egressHosts) {
    const host = new URL(url).host;
    try {
      const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
      if (r.headers.get("x-deny-reason")) blocked.push(host);
    } catch {
      blocked.push(host);
    }
  }
  if (blocked.length) {
    const hosts = [
      "api.vercel.com",
      "console.neon.tech",
      "*.neon.tech (port 5432, for prisma migrate/seed)",
      ...(apex ? ["api.cloudflare.com (for the custom domain)"] : []),
      "api.github.com (only if creating repos)",
    ];
    bail(
      P,
      "Egress to the provider APIs is blocked by this environment's network " +
        `policy (blocked: ${blocked.join(", ")}).\n` +
        "  This is NOT a credentials problem -- API tokens cannot bypass the proxy.\n" +
        "  Fix: recreate/configure the Claude Code web environment with a network\n" +
        "  policy that allows these hosts, then re-run:\n" +
        hosts.map((h) => `    - ${h}`).join("\n") +
        "\n  Docs: https://code.claude.com/docs/en/claude-code-on-the-web\n" +
        "  (Or run this script from a machine with open egress and the tokens set.)"
    );
  }
  ok(P, "Egress OK.");
}

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

await preflight();

const authSecret = randomBytes(32).toString("base64");
const seedAdminPassword = randomBytes(18)
  .toString("base64")
  .replace(/[+/=]/g, (c) => ({ "+": "A", "/": "B", "=": "" })[c]);

// 1. Neon: resolve org, create project, derive pooled connection string
let neonOrgId = process.env.NEON_ORG_ID || "";
if (!neonOrgId) {
  step(P, "Looking up Neon organization...");
  const orgs = await api(
    "Neon orgs list",
    "https://console.neon.tech/api/v2/users/me/organizations",
    { headers: { Authorization: `Bearer ${NEON_KEY}`, Accept: "application/json" } }
  );
  const orgList = orgs.organizations || [];
  if (orgList.length !== 1) {
    bail(
      P,
      orgList.length === 0
        ? "Neon API returned no organizations. Set NEON_ORG_ID."
        : `Multiple Neon orgs: ${orgList.map((o) => `${o.name} (${o.id})`).join(", ")}. Set NEON_ORG_ID.`
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
const cp = neon.connection_uris?.[0]?.connection_parameters;
if (!cp?.pooler_host) {
  bail(P, `Neon response missing pooler_host; got: ${JSON.stringify(neon).slice(0, 400)}`);
}
const databaseUrl = `postgresql://${cp.role}:${cp.password}@${cp.pooler_host}/${cp.database}?sslmode=require&channel_binding=require`;
ok(P, `Neon project: ${neon.project.id} (endpoint ${cp.endpoint_id})`);

// 2. Vercel: create project linked to the EXISTING repo, with env vars baked in
step(P, `Creating Vercel project linked to ${owner}/${slug}...`);
const envTargets = ["production", "preview", "development"];
const vercelProject = await api(
  "Vercel project create",
  `https://api.vercel.com/v11/projects${teamQs}`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
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

// 3. (Optional) Cloudflare CNAME + attach custom domain to the Vercel project
if (apex) {
  step(P, `Looking up Cloudflare zone for ${apex}...`);
  const zoneData = await api(
    "CF zone lookup",
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`,
    { headers: { Authorization: `Bearer ${CF_TOKEN}` } }
  );
  const zoneId = zoneData.result?.[0]?.id;
  if (!zoneId) bail(P, `Cloudflare zone not found: ${apex} (is the token scoped to this zone?)`);
  ok(P, `CF zone: ${zoneId}`);

  step(P, `Creating CNAME ${customDomain} -> cname.vercel-dns.com...`);
  try {
    await api("CF DNS create", `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "CNAME",
        name: subdomain,
        content: "cname.vercel-dns.com",
        proxied: false,
        ttl: 1,
        comment: `${displayName} (created by /deploy)`,
      }),
    });
    ok(P, `CF CNAME: ${customDomain} -> cname.vercel-dns.com (proxied: off)`);
  } catch (e) {
    warn(P, `CF CNAME create failed; the record may already exist. Continuing. (${e.message})`);
  }

  step(P, `Adding ${customDomain} to the Vercel project...`);
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
    ok(P, `Vercel domain: ${customDomain} (TLS issues automatically once DNS propagates)`);
  } catch (e) {
    warn(P, `Vercel domain add failed; add ${customDomain} in the project's Domains tab. (${e.message})`);
  }
}

// 4. Trigger the first production deploy. Vercel returns the numeric repoId on
//    the git link, so we don't need a GitHub token to reference it.
const repoId = vercelProject.link?.repoId;
if (repoId) {
  step(P, `Triggering first production deploy from ${ref}...`);
  try {
    const deploy = await api("Vercel deploy", `https://api.vercel.com/v13/deployments${teamQs}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: slug,
        project: vercelProject.id,
        target: "production",
        gitSource: { type: "github", ref, repoId },
      }),
    });
    ok(P, `Deploy queued: https://${deploy.url}`);
  } catch (e) {
    warn(P, `Auto-deploy trigger failed; push to ${ref} to deploy. (${e.message})`);
  }
} else {
  warn(P, `No repoId on the Vercel git link; push to ${ref} to trigger the first deploy.`);
}

// 5. Operator-facing summary
console.log(
  [
    "",
    "## Deployed",
    "",
    `- **Vercel project:** https://vercel.com/dashboard (id \`${vercelProject.id}\`)`,
    `- **Neon project:** https://console.neon.tech/app/projects/${neon.project.id}`,
    `- **Vercel URL:** https://${slug}.vercel.app (live after the build finishes, ~90s)`,
    ...(customDomain
      ? [`- **Custom URL:** https://${customDomain} (TLS issues 1-2 min after Cloudflare DNS propagates)`]
      : []),
    "",
    "The build runs `prisma migrate deploy` automatically. To seed the admin user,",
    "once the deploy is green, run from a machine with the Neon DIRECT string:",
    "",
    "    DATABASE_URL=\"<neon-direct-url>\" npx prisma db seed",
    "",
    "## Seeded admin credentials (rotate after first login)",
    "",
    `- **Email:** \`${adminEmail}\``,
    `- **Password:** \`${seedAdminPassword}\``,
    "",
  ].join("\n")
);
ok(P, "All steps completed.");
