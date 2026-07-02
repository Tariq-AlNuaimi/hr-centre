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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { step, ok, warn, bail } from "./lib/log.mjs";

const P = "deploy";

const { values } = parseArgs({
  // strict: fail fast on a typo'd flag (e.g. --slugg) instead of silently
  // ignoring it and proceeding with slug=undefined. Matches scaffold/rebrand/
  // migrate-from.
  strict: true,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Clear the pristine-template marker locally (ADR-031 / findings-register
// 2026-07-02): a deployed repo is a fork, so its next `npm run ship` must be
// gated by the db-structure domain-model check rather than stay silently exempt
// (the marker only mattered for the untouched template). Best-effort, idempotent
// text edit (preserves comments/formatting); never blocks the deploy. Commit it
// with your next push so the gate applies in CI too.
try {
  if (existsSync("project.config.json")) {
    const raw = readFileSync("project.config.json", "utf8");
    if (/"pristine":\s*true/.test(raw)) {
      writeFileSync("project.config.json", raw.replace(/"pristine":\s*true/, '"pristine": false'));
      ok(P, "Cleared pristine-template flag in project.config.json (ADR-031 db-structure gate now applies; commit it).");
    }
  }
} catch (e) {
  warn(P, `Could not clear pristine flag in project.config.json: ${e.message} (set "pristine": false manually before /ship).`);
}

// ---------------------------------------------------------------------------
// Rollback bookkeeping.
//
// Provisioning spans several providers; a failure partway through (e.g. the
// Vercel project create fails after Neon already created the database) would
// otherwise orphan whatever was created before the failure. We record each
// resource id as it's created, and `teardown()` makes a best-effort attempt to
// delete them (newest first) before we exit non-zero, printing exactly what was
// and wasn't cleaned up. Teardown is best-effort: a delete that itself fails is
// reported, never thrown, so the operator gets the full picture.
// ---------------------------------------------------------------------------
const created = { neonProjectId: null, vercelProjectId: null };

async function teardown() {
  const left = [];
  // Vercel project first (it references the repo + holds the env vars), then Neon.
  if (created.vercelProjectId) {
    step(P, `Rolling back: deleting Vercel project ${created.vercelProjectId}...`);
    try {
      const r = await fetch(
        `https://api.vercel.com/v9/projects/${created.vercelProjectId}${teamQs}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      if (r.ok || r.status === 404) ok(P, `Rolled back Vercel project ${created.vercelProjectId}.`);
      else { left.push(`Vercel project ${created.vercelProjectId} (HTTP ${r.status})`); warn(P, `Could not delete Vercel project ${created.vercelProjectId} (HTTP ${r.status}).`); }
    } catch (e) {
      left.push(`Vercel project ${created.vercelProjectId} (${e.message})`);
      warn(P, `Could not delete Vercel project ${created.vercelProjectId}: ${e.message}`);
    }
  }
  if (created.neonProjectId) {
    step(P, `Rolling back: deleting Neon project ${created.neonProjectId}...`);
    try {
      const r = await fetch(
        `https://console.neon.tech/api/v2/projects/${created.neonProjectId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${NEON_KEY}`, Accept: "application/json" } }
      );
      if (r.ok || r.status === 404) ok(P, `Rolled back Neon project ${created.neonProjectId}.`);
      else { left.push(`Neon project ${created.neonProjectId} (HTTP ${r.status})`); warn(P, `Could not delete Neon project ${created.neonProjectId} (HTTP ${r.status}).`); }
    } catch (e) {
      left.push(`Neon project ${created.neonProjectId} (${e.message})`);
      warn(P, `Could not delete Neon project ${created.neonProjectId}: ${e.message}`);
    }
  }
  if (left.length) {
    warn(P, `Manual cleanup still required for: ${left.join("; ")}`);
  } else if (created.neonProjectId || created.vercelProjectId) {
    ok(P, "Rollback complete -- no orphaned resources left behind.");
  }
}

// bailWithRollback: run best-effort teardown, then exit non-zero. Use this for
// any failure that can occur AFTER a resource has been created. Pre-creation
// validation keeps using plain bail() (nothing to clean up yet).
async function bailWithRollback(msg) {
  await teardown();
  bail(P, msg);
}

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
// and the run still succeeds -- no rollback for those (the project is already
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

// printCronManualCheck / assertCronSecretLive (#50): after the deploy, confirm
// the RUNNING deployment actually SEES CRON_SECRET -- not merely that it's set on
// the project. We wait for the deployment to be READY, then probe the audit-purge
// cron endpoint unauthenticated:
//   - HTTP 401            -> CRON_SECRET IS live (the daily cron will run).
//   - HTTP 200 {skipped}  -> CRON_SECRET NOT seen -> the cron is a dead no-op.
// Best-effort: provisioning is already complete and correct at this point, so a
// blocked egress or a slow build downgrades to a WARN + manual-check hint, never
// a hard failure (which would needlessly roll back a good deployment).
function printCronManualCheck(deployUrl) {
  console.log(
    `\n  Manual CRON_SECRET check (expect HTTP 401 once the build is live):\n` +
      `    curl -s -o /dev/null -w '%{http_code}\\n' https://${deployUrl}/api/internal/audit-purge\n`
  );
}

async function assertCronSecretLive(deployId, deployUrl) {
  step(P, "Verifying the live deployment sees CRON_SECRET (audit-purge cron)...");
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    let d;
    try {
      d = await apiTry(
        "Vercel deployment status",
        `https://api.vercel.com/v13/deployments/${deployId}${teamQs}`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
    } catch (e) {
      warn(P, `Could not read deployment status: ${e.message}`);
      break;
    }
    if (!d) {
      // apiTry returns null on a 204 / empty body; guard so the field access
      // below can't throw a TypeError out past the deploy trigger's catch and
      // surface a misleading "Auto-deploy trigger failed" on a good deploy.
      warn(P, "Deployment status response was empty; skipping CRON_SECRET verification.");
      printCronManualCheck(deployUrl);
      return;
    }
    const state = d.readyState || d.status;
    if (state === "READY") {
      ready = true;
      break;
    }
    if (state === "ERROR" || state === "CANCELED") {
      warn(P, `Deployment ended in ${state}; cannot verify CRON_SECRET -- check the Vercel build logs.`);
      return;
    }
    await sleep(10_000);
  }
  if (!ready) {
    warn(P, "Deployment did not reach READY in time; verify CRON_SECRET once it finishes.");
    printCronManualCheck(deployUrl);
    return;
  }
  try {
    const r = await fetch(`https://${deployUrl}/api/internal/audit-purge`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 && (r.headers.get("content-type") || "").includes("application/json")) {
      // Our app's auth wrapper returns a JSON 401; a Vercel Deployment-Protection
      // / SSO challenge returns an HTML 401, so the content-type guard prevents a
      // false "confirmed" when the deployment URL is gated by Vercel.
      ok(P, "CRON_SECRET confirmed live: audit-purge returns 401 to unauthenticated callers.");
    } else if (r.status === 401) {
      warn(P, "Got a non-JSON 401 (likely Vercel Deployment Protection, not our app); verify CRON_SECRET manually.");
      printCronManualCheck(deployUrl);
    } else if (r.status === 200) {
      // Match the JSON skip key (`"skipped"`) rather than the bare word, so a
      // non-JSON 200 (e.g. an edge-middleware intercept) reads as inconclusive
      // instead of a false dead-cron verdict. Robust to response nesting.
      const isJson = (r.headers.get("content-type") || "").includes("application/json");
      if (isJson && (await r.text()).includes('"skipped"')) {
        warn(
          P,
          "CRON_SECRET is NOT visible to the running deployment -- the audit-purge " +
            "cron is a dead no-op. Re-check the env var in the Vercel dashboard and redeploy."
        );
      } else {
        warn(P, "Inconclusive audit-purge probe (HTTP 200 without the skip marker); verify manually.");
        printCronManualCheck(deployUrl);
      }
    } else {
      warn(P, `Inconclusive audit-purge probe (HTTP ${r.status}); verify manually.`);
      printCronManualCheck(deployUrl);
    }
  } catch (e) {
    warn(P, `Could not reach the deployment to verify CRON_SECRET (${e.message}); likely blocked egress, not a real failure.`);
    printCronManualCheck(deployUrl);
  }
}

await preflight();

const authSecret = randomBytes(32).toString("base64");
// Audit-retention cron secret (ADR-018): provisioning it here is what activates
// the daily audit-purge cron shipped in vercel.json -- without it the cron
// no-ops (200 {skipped:true}) forever. >=32 chars per lib/env.ts.
const cronSecret = randomBytes(32).toString("base64");
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
// Record the Neon project id the moment it exists so any later failure (incl.
// the pooler_host check just below, or the Vercel create) rolls it back.
created.neonProjectId = neon.project?.id ?? null;
const cp = neon.connection_uris?.[0]?.connection_parameters;
if (!cp?.pooler_host) {
  await bailWithRollback(`Neon response missing pooler_host; got: ${JSON.stringify(neon).slice(0, 400)}`);
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
        { key: "CRON_SECRET", value: cronSecret, target: envTargets, type: "encrypted" },
      ],
    }),
  }
);
// Record so a later fatal step would roll the Vercel project back too. The
// remaining steps (CF DNS, domain attach, deploy trigger) are non-fatal
// (they only warn), so by this point provisioning is effectively done.
created.vercelProjectId = vercelProject.id ?? null;
ok(P, `Vercel project: ${vercelProject.id} (${vercelProject.name})`);

// 2b. Confirm all env vars are visible on the project BEFORE triggering the
// first deploy (#50). The create call sets them synchronously, but we re-read to
// defeat any eventual-consistency lag between the env-var write and the build
// pulling env -- the root cause of a dead audit-purge cron (and an unseeded
// admin) on fresh forks: a first build that runs before CRON_SECRET / the
// SEED_ADMIN_* vars land bakes in a no-op cron forever and seeds no admin. We
// only trigger the deploy once all six keys are confirmed present.
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
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
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
    warn(P, `Env not fully propagated yet (missing: ${lastMissing.join(", ")}); retrying in ${attempt * 2}s...`);
    await sleep(attempt * 2000);
  }
}
if (!envConfirmed) {
  await bailWithRollback(
    `Env vars did not propagate to the Vercel project after 5 attempts ` +
      `(still missing: ${lastMissing.join(", ")}). Aborting BEFORE deploy so we ` +
      `don't ship a first build that can't see CRON_SECRET / SEED_ADMIN_* ` +
      `(dead cron + no admin user).`
  );
}
ok(P, `All ${expectedEnvKeys.length} env vars confirmed on the project.`);

// 3. (Optional) Cloudflare CNAME + attach custom domain to the Vercel project
if (apex) {
  step(P, `Looking up Cloudflare zone for ${apex}...`);
  const zoneData = await api(
    "CF zone lookup",
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(apex)}`,
    { headers: { Authorization: `Bearer ${CF_TOKEN}` } }
  );
  const zoneId = zoneData.result?.[0]?.id;
  if (!zoneId) await bailWithRollback(`Cloudflare zone not found: ${apex} (is the token scoped to this zone?)`);
  ok(P, `CF zone: ${zoneId}`);

  step(P, `Creating CNAME ${customDomain} -> cname.vercel-dns.com...`);
  try {
    await apiTry("CF DNS create", `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
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
    await apiTry(
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
    const deploy = await apiTry("Vercel deploy", `https://api.vercel.com/v13/deployments${teamQs}`, {
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
    // Post-deploy assertion: confirm the running deployment sees CRON_SECRET (#50).
    if (deploy.id && deploy.url) {
      await assertCronSecretLive(deploy.id, deploy.url);
    }
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
    "The build runs `prisma migrate deploy` AND seeds the admin user automatically",
    "(SEED_ADMIN_EMAIL/PASSWORD are set on the project; prisma/seed.ts is idempotent),",
    "so you can log in as soon as the deploy is green -- no manual seed step. If you",
    "ever need to re-seed manually, run from a machine with the Neon DIRECT string:",
    "",
    "    DATABASE_URL=\"<neon-direct-url>\" SEED_ADMIN_EMAIL=\"…\" SEED_ADMIN_PASSWORD=\"…\" npx prisma db seed",
    "",
    "## Seeded admin credentials (rotate after first login)",
    "",
    `- **Email:** \`${adminEmail}\``,
    `- **Password:** \`${seedAdminPassword}\``,
    "",
  ].join("\n")
);
ok(P, "All steps completed.");
