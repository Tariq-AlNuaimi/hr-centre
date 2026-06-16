---
name: first-fork
description: One-time setup after forking the template. Walks the operator through signing up at Vercel + Neon, connecting the repo, pasting two env vars, and getting the first live URL. Targets non-developer audiences -- the operator iterates with Claude, the team reviews via shared URLs, the IT team takes over later via /handoff. Use when the user says "set up a new project", "fork bootstrap", "first-fork", "I just cloned the template", "/first-fork".
---

# /first-fork — New project bootstrap (Vercel + Neon)

> **The template is a prototype rail (ADR-006).** Push → live URL in 90 seconds.
> No droplets, no Docker, no GHCR, no Caddy. Everything happens on Vercel.
> When the project is approved, `/handoff` packages it for the IT team's
> own production setup.

## Preconditions

- The operator has a Vercel account (free tier is fine): https://vercel.com
- The operator has a Neon account (free tier is fine): https://neon.tech
- The fork is already created (e.g. `gh repo create … --template`) and pushed.
- The operator has `npm` locally and can run `git push`.

## Setup (target: ~10 min total)

### 1. Rebrand

```sh
npm install
npm run rebrand -- --slug <kebab-slug> --name '<Display Name>' --owner <gh-owner>
git add -A && git commit -m 'chore: rebrand from template' && git push
```

### 1b. Set the project tier

The repo ships `project.config.json` with `"tier": "personal"`. Ask the operator
which this project is and set it:

- **`personal`** — never shared with the company. No `/handoff`, no compliance
  section, no CI ceremony. (Default — leave it.)
- **`shared`** — a company project that will flow to an IT handoff and may carry
  PDPL/compliance obligations. Set `"tier": "shared"`.

The **security floor is identical for both** (auth wrappers, no leaked secrets,
zod at the boundary, no raw SQL, the eight ESLint rules, audit log ON, `/ship`
before push). The tier only scales the ceremony on top. See `CLAUDE.md`
"Project tiers". Commit the change with the rebrand commit in step 1.

### 2. Create a Neon Postgres project

1. Open https://console.neon.tech → **New Project**.
2. Name it the same as the repo slug. Region: pick one near you (e.g. `eu-central-1`).
3. Postgres 17 is the default — keep it.
4. After creation, Neon shows two connection strings:
   - **Pooled** (`...-pooler.<region>.aws.neon.tech...`) — use this as `DATABASE_URL`.
   - **Direct** (`...<region>.aws.neon.tech...`) — keep for `prisma migrate` from your laptop.
5. Copy the pooled string. You'll paste it in step 4.

### 3. Connect Vercel to the GitHub repo

1. Open https://vercel.com/new.
2. **Import Git Repository** → pick the new fork.
3. **Framework Preset**: Next.js (auto-detected).
4. **Root Directory**: leave as default.
5. **Build & Output**: leave defaults — `vercel.json` in the repo overrides them
   to run `prisma generate && prisma migrate deploy && next build`.
6. Click **Deploy** — it'll fail on the first build because env vars are missing.
   That's expected. Continue to step 4.

### 4. Set env vars in Vercel

In the Vercel project → **Settings → Environment Variables**, add:

| Name | Value | Environments |
|---|---|---|
| `DATABASE_URL` | the Neon **pooled** connection string from step 2 | Production, Preview, Development |
| `AUTH_SECRET` | `openssl rand -base64 32` output | Production, Preview, Development |
| `AUTH_URL` | leave empty — Vercel sets it automatically | — |
| `NEXT_PUBLIC_APP_NAME` | your app's display name | Production, Preview, Development |
| `SEED_ADMIN_EMAIL` | your email | Production |
| `SEED_ADMIN_PASSWORD` | a strong password (rotate after first login) | Production |

Then **Deployments → Redeploy** the latest deployment.

### 5. Run the first migration

The build command (`prisma migrate deploy`) creates the tables automatically on
every deploy. To seed the admin user on first boot, **once the Vercel deploy is
green**, hit the seed endpoint manually:

```sh
# From your laptop, using the Neon DIRECT connection string (not pooled):
DATABASE_URL="postgresql://...<region>.aws.neon.tech/...?sslmode=require" \
  npx prisma db seed
```

(The seed only runs once — it creates the admin user and exits if the user
already exists.)

### 6. Share the URL with your team

The Vercel deployment URL is `https://<slug>-<hash>-<team>.vercel.app`. To get
a stable URL:

- **Production**: `https://<slug>.vercel.app` (Vercel auto-assigns).
- **Custom domain** (optional): Vercel project → Settings → Domains → add your
  domain → Vercel walks you through the CNAME / NS records.

That URL is what you share with your non-developer team. Every `git push` to
`main` updates production at that URL in ~90 seconds. Every push to a non-main
branch creates a fresh preview URL automatically.

### 7. Confirm the loop

1. Make a tiny change (e.g. edit the title in `messages/en.json`).
2. `git push`.
3. Watch the Vercel dashboard — new deployment kicks off in seconds.
4. Open the URL in ~90s. The change is live.

If this works, the rail is set up. From here:
- Use `/scaffold-entity` to add CRUD entities.
- Use `/ship` before every push to catch typecheck / lint / build errors locally.
- When the project gets complex (cron, file uploads, background jobs), use
  `/scale-up`.
- When the team approves, use `/handoff` to produce a clean package for IT.

## Optional extras (only when you need them)

- **Sentry**: create projects at sentry.io, set `SENTRY_DSN`,
  `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`,
  `SENTRY_AUTH_TOKEN` as Vercel env vars. Errors flow to Sentry on next deploy.
- **SMTP**: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
  `SMTP_FROM`. Email is gated on `SMTP_HOST` — when unset, `sendEmail()`
  returns `{ sent: false }` and the app still runs.
- **Audit purge cron**: already wired — `vercel.json` ships a daily cron
  GETting `/api/internal/audit-purge`. To activate it, set **`CRON_SECRET`**
  (>=32 chars, `openssl rand -base64 48`) as a Vercel env var; until then the
  cron is a silent no-op. `AUDIT_PURGE_TOKEN` is only for manual/Actions POSTs.
  (ADR-018; /deploy sets `CRON_SECRET` automatically.)

## What you do NOT need

The template no longer requires (these are dropped vs. previous versions):

- ~~DigitalOcean PAT~~
- ~~Cloudflare API token~~
- ~~SSH keys / GHCR tokens~~
- ~~age + rclone backup config~~ (Neon does PITR on the Launch tier)
- ~~Portainer / Docker / GHCR~~
- ~~Branch protection workflow~~ (your team isn't on GitHub)

If your project later needs self-hosted infra, that's the IT team's call
after `/handoff`. The rail's job is to get you to "approved" fast.

## Report back

When done, the operator should be able to confirm:
- Vercel project URL (production).
- Neon project URL (database dashboard).
- First seeded admin email + (rotated) password.
- One screenshot or short note: "this is live, my team can review it now."
