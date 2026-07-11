---
name: deploy
description: Provision Neon + Vercel for the CURRENT repo and ship it to a live URL from a Claude Code web session (or any machine with egress + tokens). Use when the user says "deploy this", "ship it live", "/deploy", "put it on Vercel", "get me a URL" -- for a fork that already exists on GitHub but has never been connected to Vercel/Neon. For a brand-new repo from the template, use /new-project (Actions) or /first-fork (manual).
---

# /deploy — Existing fork → live URL, headless

Turns a fork you've already built in into a live `<slug>.vercel.app` URL without
the browser clicking of `/first-fork`. Backed by `scripts/deploy.mjs`, which
calls the Neon + Vercel APIs directly (the same logic `/new-project` uses, minus
the repo-create and Cloudflare steps).

## First move — RUN the preflight, do not assume "no access"

**A live URL is the default goal. Do not pre-emptively tell the operator you lack
access.** The token table and egress list below are _reference_, not a reason to
stop. The only authority on whether this environment can deploy is the
provisioner's own preflight (`scripts/deploy.mjs` → `preflight()`), which actually
probes `api.vercel.com` + `console.neon.tech` and prints either **`Egress OK.`**
or the exact blocked hosts.

So the order is: **run the command, read the verdict, then report** — never the
reverse. Specifically:

- Do **not** say "I don't have access / tokens aren't set / I'll set it up
  locally" before the preflight has actually run and failed.
- If preflight prints `Egress OK.` and the run proceeds → you HAVE access; finish
  the deploy and report the live URL.
- If it fails, read WHY: blocked egress (`x-deny-reason` / network policy — _not_
  fixable with tokens) vs. a genuinely missing token (the script names which).
  Report that specific cause, not a generic "no access."
- Only fall back to local dev if the operator explicitly asks for local, or
  preflight shows egress is blocked AND there's no machine with egress available.

## Precondition — the GitHub repo must already exist

`/deploy` links a Vercel project to an **existing** `<owner>/<slug>` GitHub repo;
it does not create one. If the repo doesn't exist yet, stop and use `/new-project`
(Actions) or `/first-fork` (manual) — those create the repo first. Confirm the repo
is present before running the provisioner.

## Hard prerequisite — network egress

`scripts/deploy.mjs` talks to `api.vercel.com` and `console.neon.tech`. In a
**Claude Code web session**, outbound traffic is governed by the environment's
**network policy** (an allowlist proxy). If those hosts aren't allowed, every
request returns `403 x-deny-reason: host_not_allowed` — and **no API token can
bypass it**. The script runs a preflight check and, if blocked, prints the exact
hosts to allow and stops.

To make this work from the web, the environment must be created/configured with
a network policy that allows:

- `api.vercel.com`
- `console.neon.tech`
- `api.github.com` (only if the script auto-creates the GitHub repo; **not** needed
  when the repo already exists — and for `/deploy` it normally does, see the
  precondition below. Allow it only to silence a false "blocked egress" report
  when repo-create is in play.)
- `api.cloudflare.com` (only if attaching a custom domain with `--apex`)
- `*.neon.tech` on port 5432 (only if you also run `prisma migrate`/`seed` from
  the session; otherwise seed from your laptop with the Neon **direct** string)

See https://code.claude.com/docs/en/claude-code-on-the-web . If egress can't be
opened, run the same command from a laptop with the tokens set — it's identical.

## Tokens (set as environment variables, never pasted in chat)

| Env var                | What                                                                    | Where to mint                                   |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `NEON_API_KEY`         | Neon account API key                                                    | https://console.neon.tech/app/settings/api-keys |
| `VERCEL_TOKEN`         | Vercel account token                                                    | https://vercel.com/account/tokens               |
| `CLOUDFLARE_API_TOKEN` | only for `--apex`; custom token scoped `Zone.DNS:Edit` on the apex zone | https://dash.cloudflare.com/profile/api-tokens  |
| `VERCEL_TEAM_ID`       | optional, only for Team-scoped projects                                 | Vercel team settings                            |
| `NEON_ORG_ID`          | optional, only if your key sees multiple Neon orgs                      | Neon settings                                   |

## Custom domain (optional)

Pass `--apex <zone>` (a domain you control in Cloudflare) and optionally
`--subdomain <label>` (defaults to the slug) to get
`https://<label>.<zone>` with automatic TLS. The script creates the
`CNAME -> cname.vercel-dns.com` (DNS-only, not proxied) and attaches the domain
to the Vercel project. Without `--apex`, the project is reachable at
`<slug>.vercel.app` only. Requires `CLOUDFLARE_API_TOKEN`.

## Steps

1. **Confirm inputs.** Read `project.config.json` and `package.json` for the slug
   and display name; confirm the GitHub `--owner` and an `--admin-email`.
2. **Run `/ship` first** — never deploy a red build.
3. **Run the provisioner:**
   ```sh
   npm run deploy -- --slug <kebab-slug> --display-name "<Display Name>" \
     --owner <gh-owner> --admin-email <you@example.com>
   ```
   It preflights egress, creates the Neon project, creates the Vercel project
   linked to `<owner>/<slug>` with the 6 env vars (`DATABASE_URL`, `AUTH_SECRET`,
   `NEXT_PUBLIC_APP_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and
   `CRON_SECRET` -- the last activates the daily audit-retention cron, ADR-018),
   and triggers the first production deploy.
4. **Seed the admin** once the build is green (the build auto-runs
   `prisma migrate deploy`):
   ```sh
   DATABASE_URL="<neon-direct-url>" npx prisma db seed
   ```
5. **Report** the production URL + seeded admin email/password (tell the operator
   to rotate the password after first login).

## On mid-provision failure (teardown / rollback)

Provisioning is multi-step (Neon project → Vercel project + env vars → first deploy)
and not atomic — a failure partway can leave **orphaned** resources (a Neon project
with no Vercel project, or a Vercel project pointing at a dead DB). The script does a
**best-effort cleanup** of resources it created in the failed run, then reports
**what was and wasn't cleaned**. Cleanup is best-effort only: if an API call to delete
fails (rate limit, revoked token), the orphan stays.

After any failed run, treat the result as untrusted and **verify in the dashboards**
before retrying — Neon (https://console.neon.tech) for a stray project, Vercel
(https://vercel.com/dashboard) for a stray project — and delete by hand whatever the
report listed as not cleaned. Re-running `/deploy` over an un-cleaned partial state can
create duplicates.

## Do NOT

- Do **not** paste tokens or the generated `AUTH_SECRET`/admin password into a
  committed file. They go in env vars / the Vercel project only.
- Do **not** claim the deploy failed for "missing credentials" when the real
  cause is blocked egress — the preflight distinguishes the two; report which.
- Do **not** use this for a brand-new repo that doesn't exist yet — that's
  `/new-project` (Actions) or `/first-fork` (manual).
