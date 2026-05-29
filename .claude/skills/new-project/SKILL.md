---
name: new-project
description: One-prompt provisioner for a brand-new prototype. Creates a GitHub repo from this template, a Neon Postgres project, a Vercel project (with env vars set), and a Cloudflare CNAME for a custom domain -- in ~3 minutes. Use when the user says "new project", "start a project for ...", "spin up X", "/new-project", or describes a brand-new prototype they want to share with their team.
---

# /new-project — Idea → live URL on a custom domain, in one workflow run

> **⚠️ SHELVED on the current plan (ADR-007).** This skill is itself a GitHub Actions
> workflow (`new-project.yml`) and **cannot run while Actions billing is blocked**.
> Until billing is restored, use **`/first-fork`** (manual on-ramp) instead — it is the
> working path to a live URL on Vercel + Neon.
>
> Its **Cloudflare DNS step is still wired** post-ADR-006: `new-project.yml` uses
> `CLOUDFLARE_API_TOKEN` + `NEON_API_KEY` + `VERCEL_TOKEN` (no DO / SSH / GHCR / Portainer
> remain). So when Actions billing returns, this skill works as written — including the
> custom-domain CNAME.

The fastest path from "I want to start a brand new prototype" to a live URL
on `<slug>.<apex>` with TLS. Single trigger, ~3 minutes. Backed by
`.github/workflows/new-project.yml`.

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

1. **GitHub** — creates `tariq-alnuaimi/<slug>` from this template (private repo).
2. **Neon** — creates a Postgres 17 project in the configured region, captures the pooled `DATABASE_URL`.
3. **Vercel** — creates a project linked to the new GitHub repo with 5 env vars baked in:
   - `DATABASE_URL` (the Neon pooled URL)
   - `AUTH_SECRET` (random 32 bytes)
   - `NEXT_PUBLIC_APP_NAME` (the display name)
   - `SEED_ADMIN_EMAIL` (the operator's email)
   - `SEED_ADMIN_PASSWORD` (random; surfaced in the run summary)
4. **Cloudflare** — creates a CNAME record `<slug>.<apex>` → `cname.vercel-dns.com` (proxied: off — Vercel needs DNS-validated TLS).
5. **Vercel** — attaches the custom domain to the project; Vercel auto-issues a Let's Encrypt cert once DNS propagates.
6. **Vercel** — triggers the first production deployment. The build runs `prisma migrate deploy && prisma db seed && next build`, so tables + admin user are ready when the URL goes live.

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
3. Start a Claude Code session on `tariq-alnuaimi/<slug>` and type:
   ```
   /quickstart "describe your idea here"
   ```
   I'll scaffold the entities, push, and the URL updates with the new features.

## Failure recovery

The script is not fully idempotent on the first version. If a step fails partway:

- **GitHub repo created, Neon failed**: delete the GitHub repo (Settings → Danger zone → Delete) and re-run.
- **Neon created, Vercel failed**: delete the Neon project + GitHub repo, re-run.
- **Cloudflare CNAME or Vercel domain attach failed**: the workflow logs say which. Run those steps manually via the providers' dashboards. The project is still functional via the `.vercel.app` URL.

Re-running with the same slug will fail at step 1 (GitHub already has the repo).
Clean up first.

## When NOT to use

- The project is mid-flight and already has a repo / Neon / Vercel project — use the regular workflow instead.
- You want a self-hosted droplet deploy — that flow was removed in ADR-006.
- You're handing off to the IT team — use `/handoff` instead, which produces a
  clean tarball + docs.
