---
name: new-project
description: One-prompt provisioner for a brand-new prototype. Creates a GitHub repo from this template, a Neon Postgres project, a Vercel project (with env vars set), and a Cloudflare CNAME for a custom domain -- in ~3 minutes. Use when the user says "new project", "start a project for ...", "spin up X", "/new-project", or describes a brand-new prototype they want to share with their team.
---

# /new-project — Idea → live URL on a custom domain, in one workflow run

> **Two ways to run the same `scripts/new-project.mjs`:**
> 1. **Headless from a Claude Code web session (or any machine)** — the **PRIMARY path**.
>    `npm run new-project -- ...` with the tokens set as env vars and egress allowed.
>    No GitHub Actions needed. See **"Run headlessly"** below.
> 2. **GitHub Actions workflow** (`new-project.yml`) — **dormant** until Actions billing
>    is enabled (ADR-007). Identical logic; activates as written once billing is on.
>
> For an **existing** fork you've already built in (no repo creation), use **`/deploy`**.
> For a fully manual browser walk-through, use **`/first-fork`**.

The fastest path from "I want to start a brand new prototype" to a live URL — it
creates the GitHub repo from this template, the Neon DB, the Vercel project, an
optional Cloudflare custom domain, and the first deploy, in one command.

## Run headlessly (Claude Code web session or any machine)

```sh
npm run new-project -- \
  --slug <kebab-slug> --display-name "<Display Name>" \
  --owner <gh-owner> --admin-email <you@example.com> \
  [--apex <your-zone> [--subdomain defaults-to-slug]]   # omit for <slug>.vercel.app only
```

**`--owner`** is the GitHub org or user that will own the new repo — the
account the repo gets created under, e.g. `--owner Tariq-AlNuaimi` creates
`Tariq-AlNuaimi/<slug>`. Use your own GitHub username if you're not creating it
under an organization.

**Tokens** (env vars, never in chat): `GH_AUTOMATION_TOKEN` (GitHub PAT, scopes
`repo` + `workflow`), `NEON_API_KEY`, `VERCEL_TOKEN`, and `CLOUDFLARE_API_TOKEN`
only when `--apex` is used. Optional: `VERCEL_TEAM_ID`, `NEON_ORG_ID`.

**Egress** (Claude Code web network policy): `api.github.com`, `api.vercel.com`,
`console.neon.tech` (and `api.cloudflare.com` with `--apex`). The script runs a
**preflight** and, if a host is blocked, prints exactly which to allow and stops —
a blocked host is an env-config issue, not a missing token. Docs:
https://code.claude.com/docs/en/claude-code-on-the-web

**Seed the admin** once the first build is green (the build runs `prisma migrate
deploy`): from a machine with the Neon **direct** string,
`DATABASE_URL="..." npx prisma db seed`. The script prints the generated admin
email + password to rotate.

## GitHub Actions path (dormant)

Backed by `.github/workflows/new-project.yml` — identical logic, triggered from the
Actions tab. Activates when Actions billing is enabled (ADR-007); the headless path
above is the primary one until then.

## Preconditions (one-time, per template repo)

Set on `Tariq-AlNuaimi/fullstack-vibe-template` → Settings → Secrets and
variables → Actions:

| Type | Name | What it is | Where to mint |
|---|---|---|---|
| Secret | `GH_AUTOMATION_TOKEN` | GitHub classic PAT with `repo` + `workflow` + `delete_repo` | https://github.com/settings/tokens |
| Secret | `NEON_API_KEY` | Neon account API key | https://console.neon.tech/app/settings/api-keys |
| Secret | `VERCEL_TOKEN` | Vercel account token | https://vercel.com/account/tokens |
| Secret | `CLOUDFLARE_API_TOKEN` | CF custom token, scoped `Zone.DNS:Edit` on the apex zone | https://dash.cloudflare.com/profile/api-tokens |
| Variable | `APEX_DOMAIN` | e.g. `ops-rihal.com` (default if unset) | repo Variables tab |
| Variable | `GH_OWNER` | GitHub user/org that holds new repos (defaults to template's owner) | repo Variables tab |
| Variable | `NEON_REGION` | Neon region id, e.g. `aws-eu-central-1` (default) | repo Variables tab |
| Variable | `VERCEL_TEAM_ID` | Optional. Only set if you create projects under a Vercel Team rather than personal. | repo Variables tab |

The 2 secrets you likely already have from the old `/first-fork` droplet
flow are `GH_AUTOMATION_TOKEN` + `CLOUDFLARE_API_TOKEN`. `NEON_API_KEY` +
`VERCEL_TOKEN` are net new for the prototype rail.

## Trigger

From a phone, laptop, or anywhere with a browser:

1. Open https://github.com/Tariq-AlNuaimi/fullstack-vibe-template/actions/workflows/new-project.yml
2. Tap **Run workflow**
3. Fill in: `slug` (kebab-case), `display_name`, `admin_email`
4. Tap the green **Run workflow** button

Or via `gh` CLI:

```sh
gh workflow run new-project.yml \
  -R Tariq-AlNuaimi/fullstack-vibe-template \
  -f slug=staffing \
  -f display_name="Staffing" \
  -f admin_email=alnaaime@gmail.com
```

## What happens (~3 minutes)

1. **GitHub** — creates `Tariq-AlNuaimi/<slug>` from this template (private repo).
2. **Neon** — creates a Postgres 17 project in the configured region, captures the pooled `DATABASE_URL`.
3. **Vercel** — creates a project linked to the new GitHub repo with 5 env vars baked in:
   - `DATABASE_URL` (the Neon pooled URL)
   - `AUTH_SECRET` (random 32 bytes)
   - `NEXT_PUBLIC_APP_NAME` (the display name)
   - `SEED_ADMIN_EMAIL` (the operator's email)
   - `SEED_ADMIN_PASSWORD` (random; surfaced in the run summary)
4. **Cloudflare** — creates a CNAME record `<slug>.<apex>` → `cname.vercel-dns.com` (proxied: off — Vercel needs DNS-validated TLS).
5. **Vercel** — attaches the custom domain to the project; Vercel auto-issues a Let's Encrypt cert once DNS propagates.
6. **Vercel** — triggers the first production deployment. The build runs `prisma migrate deploy && next build`, so tables are ready when the URL goes live. Seeding the admin is a separate one-shot step (surfaced in the run summary) — the build does **not** seed, so a forgotten `SEED_ADMIN_PASSWORD` can't ship a guessable admin.

## Output

Find the run in the workflow's run history. The run's **Summary** tab shows:

- GitHub repo URL
- Vercel project URL
- Neon project URL
- Production URL (`https://<slug>.<apex>`)
- Vercel preview URL (`https://<slug>.vercel.app`, available immediately)
- Seeded admin email + password (rotate after first login)

## After provisioning

1. Wait ~2 min for the first Vercel build + DNS propagation.
2. Open `https://<slug>.<apex>` and log in with the seeded credentials.
3. **Set the project tier** right after provisioning (mirrors `/first-fork`): edit
   `project.config.json` `"tier"` to `personal` (default) or `shared`, then commit
   + push. The security floor is identical either way; the tier only scales the
   ceremony (see `CLAUDE.md` "Project tiers").
4. Start a Claude Code session on `Tariq-AlNuaimi/<slug>` and type:
   ```
   /quickstart "describe your idea here"
   ```
   I'll scaffold the entities, push, and the URL updates with the new features.

> **Free-tier limits:** the Vercel project lands on the **Hobby** plan
> (100 GB-hours of serverless function execution per month, non-commercial use).
> Fine for a prototype shared with a review team; if the app gets heavy traffic or
> goes commercial, upgrade at Vercel project → Settings → Billing (Pro plan).

## Failure recovery

The script is not fully idempotent on the first version. If a step fails partway:

- **GitHub repo created, Neon failed**: delete the GitHub repo (Settings → Danger zone → Delete) and re-run.
- **Neon created, Vercel failed**: delete the Neon project + GitHub repo, re-run.
- **Cloudflare CNAME or Vercel domain attach failed**: the workflow logs say which. Run those steps manually via the providers' dashboards. The project is still functional via the `.vercel.app` URL.

Re-running with the same slug will fail at step 1 (GitHub already has the repo).
Clean up first.

**Changing args after a successful run** (e.g. a different admin email, display
name, or DB region): the env vars are baked in at provision time, so editing the
command and re-running won't take. Delete the **Vercel project + Neon project**
(and the GitHub repo if you also want the repo recreated), then re-run with the
new args. That delete-then-re-run is the idempotency boundary.

## When NOT to use

- The project is mid-flight and already has a repo / Neon / Vercel project — use the regular workflow instead.
- You want a self-hosted droplet deploy — that flow was removed in ADR-006.
- You're handing off to the IT team — use `/handoff` instead, which produces a
  clean tarball + docs.
