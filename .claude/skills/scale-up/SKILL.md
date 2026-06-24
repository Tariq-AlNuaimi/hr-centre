---
name: scale-up
description: Add a capability the prototype rail doesn't ship with -- file uploads, background jobs, cron, realtime, custom domain, bigger DB, feature flags, observability. Each item has a "when to add it" trigger and a recipe. Suggests; doesn't auto-install. Use when the user says "the project needs X", "we need to add file uploads / cron / background jobs / realtime / custom domain", "this is getting bigger", "scale-up", "/scale-up".
---

# /scale-up — Growth path for the prototype rail

The template starts simple. As the project grows during validation, these are
the additions Vercel + Neon make easy. Each item: **trigger** (when to add),
**recipe** (what to add), **cost** (so the operator knows).

Pick one or more based on what the user is describing. Confirm with the user
before installing anything; this skill suggests, the operator approves.

## Shared-tier capability recipes (post-UAT / at `/handoff`)

For the heavier `shared`-tier security + SaaS capabilities, full copy-paste,
template-specific recipes live in `docs/recipes/` (kept OUT of the lean base — see
ADR-014). When a graduating project needs one, open the recipe and apply it
(then `/code-review` + `/ship`):

**Shared-tier security** (`docs/recipes/shared-security/`, mirrors SECURITY.md §16):
- `1-account-lockout.md` — per-account lockout + cross-instance limiter (Upstash); closes the rest of T-01
- `2-mfa-totp.md` — TOTP 2FA (otplib + qrcode); closes T-02
- `3-nonce-csp.md` — nonce-based CSP (drops `'unsafe-inline'` script-src; AntD cssinjs nonce wiring)
- `4-atomic-audit-triggers.md` — Postgres-trigger audit (closes ADR-010 non-atomicity + the bulk/upsert blind spot)
- `5-column-encryption.md` — AES-256-GCM field encryption for Restricted columns
- `6-can-helper.md` (O12) — `can(user, action, resource)` per-resource / row-level authorization on top of the role wrappers (e.g. EDITOR edits only their own records); SECURITY.md §3

**Performance** (`docs/recipes/perf/`):
- `1-rsc-list-reads.md` (O1) — convert a client-fetch list page to a React Server Component reading Prisma from `searchParams`, with a client island for the interactive DataTable
- `2-search-trigram.md` (O4) — `pg_trgm` GIN indexes so `ILIKE`/`contains` search uses an index instead of a seq scan at volume
- `3-perf-budget-uat.md` (O9) — opt-in Lighthouse / bundle-size budget in the `/uat` flow that fails the run on regression
- **List virtualization** (CP-PO7) — `DataTable` paginates server-side by default, so this is only needed if a fork renders very large client-side `pageSize`s (e.g. an in-page export preview). Add `virtual` + a fixed `scroll.y` to the AntD `Table` (AntD 6 ships row virtualization), or drop in `@tanstack/react-virtual`. A per-page change, not a base dependency.

**Developer experience** (`docs/recipes/dx/`):
- `1-storybook.md` (O7) — Storybook 8 for the shared component library (DataTable / Chart / KanbanBoard / EmptyState / ConfirmAction) with the AntD `ConfigProvider` + `next-intl` decorator; dev-only, kept out of the base (ADR-014)

**SaaS features** (`docs/recipes/saas/`):
- `1-sso-oidc-saml.md` — enterprise SSO via the `mapSsoRole` seam (OIDC + SAML/jackson), JIT provisioning
- `2-api-keys-openapi.md` — per-consumer API keys (hashed, scoped) on the `/api/v1` + `withApiAuth` seam, + OpenAPI/Swagger
- `3-webhooks.md` — outbound HMAC-signed webhooks + delivery log
- `4-scim-provisioning.md` — SCIM 2.0 user/group lifecycle for IdP-driven provisioning

---

## 1. File uploads (Vercel Blob)

**Trigger:** team needs to attach PDFs, images, contracts to records.

**Recipe:**

```sh
npm install @vercel/blob
```

Create `lib/storage.ts`:

```ts
import { put, del, head } from "@vercel/blob";

export async function uploadFile(filename: string, body: ReadableStream | Buffer | File) {
  const blob = await put(filename, body, { access: "public" });
  return blob.url; // store this in the entity field
}

export async function deleteFile(url: string) {
  await del(url);
}
```

In the Vercel project → Storage → **Create Blob store**. Vercel injects
`BLOB_READ_WRITE_TOKEN` automatically.

Add the env var to `.env.example` and `lib/env.ts`'s zod schema:

```ts
BLOB_READ_WRITE_TOKEN: z.string().optional(),
```

Add a presign API route under `app/api/storage/presign/route.ts` -- mirror
the old MinIO version but call `put()` from `@vercel/blob`.

**Cost:** free 5 GB, then $0.15/GB/month + $0.04/GB egress.

---

## 2. Background jobs / async work (Inngest)

**Trigger:** team wants emails sent without blocking the request, batch
processing, webhooks that fan out, scheduled reports.

**Recipe:**

```sh
npm install inngest
```

Create `lib/inngest.ts`:

```ts
import { Inngest } from "inngest";
export const inngest = new Inngest({ id: "<slug>" });
```

Create `app/api/inngest/route.ts`:

```ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { sendWelcomeEmail } from "@/lib/jobs";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [sendWelcomeEmail] });
```

Sign up at https://inngest.com, connect the Vercel project, copy
`INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` into Vercel env vars.

**Cost:** free 50k steps/month; $20/mo for more.

---

## 3. Cron (Vercel Cron, built in)

**Trigger:** daily report email, hourly cleanup, any scheduled job.

**Already shipped:** the template ships ONE cron out of the box — the daily
audit-log purge (`/api/internal/audit-purge`, `0 3 * * *`; ADR-018). Do not
remove it when adding more.

**Recipe:** ADD an entry to the existing `crons` array in `vercel.json` —
**edit, never overwrite, that file** (it also carries the `buildCommand` with
the migrate + seed steps):

```jsonc
// vercel.json -- ADD to the existing "crons" array:
{ "path": "/api/internal/<your-job>", "schedule": "0 6 * * *" }
```

**Auth:** Vercel Cron authenticates by sending `Authorization: Bearer
$CRON_SECRET` (set that env var on the project) — it **cannot** send a custom
`x-internal-token` header. The shipped `withInternalAuth` already supports
this: wrap the new route with
`withInternalAuth("CRON_SECRET", handler, { bearer: true, skipWhenUnconfigured: true })`
and compose `withRateLimit` outside it (copy the pattern from
`app/api/internal/audit-purge/route.ts`).

> **`withRateLimit` MUST compose OUTSIDE `withInternalAuth`** (OWASP A04) — so a
> flood is throttled *before* any auth/handler work runs, not after. The correct
> pattern is `withRateLimit(withInternalAuth(..., handler), { ... })`. See
> `app/api/internal/audit-purge/route.ts` for the reference order; the
> `no-rate-limit-inside-auth` ESLint rule enforces this.

External schedulers that CAN send
custom headers (e.g. GitHub Actions) use a plain `withInternalAuth("<TOKEN_ENV>", handler)`
and send `x-internal-token`.

**Cost:** free on Hobby; included on Pro.

---

## 4. Realtime (Pusher Channels)

**Trigger:** team wants live updates (kanban cards moving without refresh,
live notifications, chat).

**Recipe:**

```sh
npm install pusher pusher-js
```

Create `lib/realtime.ts`:

```ts
import Pusher from "pusher";
export const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
});
```

In API mutations: `await pusher.trigger("channel-name", "event", payload)`.
In React: subscribe via `pusher-js`.

**Cost:** free 100 connections + 200k messages/day.

---

## 5. Bigger DB / point-in-time recovery (Neon Launch)

**Trigger:** DB hits ~500 MB; or team wants restore-to-yesterday capability;
or response times are growing.

**Recipe:** Neon dashboard → Billing → upgrade to **Launch** ($19/mo).

What you get:
- 10 GB storage (vs. 0.5 GB free).
- PITR (point-in-time recovery) up to 7 days.
- Larger compute autoscaling ceiling.
- Multiple projects on one plan.

No code change required.

---

## 6. Custom domain

**Trigger:** team is uncomfortable sharing `*.vercel.app` URLs externally; or
the project is approaching handoff and needs a stable name.

**Recipe:** Vercel project → Settings → Domains → **Add**.

If you control DNS at Cloudflare / Route53: Vercel walks you through the
CNAME record (apex domains use Vercel's IP). HTTPS is automatic (Let's
Encrypt via Vercel).

**Cost:** $0 (Vercel includes custom domains on Hobby).

---

## 7. Feature flags (Vercel Edge Config or PostHog)

**Trigger:** want to A/B test, gate features behind an env, roll out gradually.

**Recipe (simplest, Edge Config):**

```sh
vercel env add EDGE_CONFIG
```

Vercel dashboard → Storage → Create Edge Config → paste the connection string.

In code:

```ts
import { get } from "@vercel/edge-config";
const flag = await get("new-dashboard-enabled"); // boolean
```

**Cost:** free 8k reads + 50 writes/month; $5/mo for more.

---

## 8. Observability (Sentry, already wired)

**Trigger:** errors in production are invisible; need stack traces from users
who hit bugs.

**Recipe:** see `/first-fork` "Optional extras". The template already imports
Sentry; you just need to set the env vars.

**Cost:** free 5k events/month.

---

## 9. Auth: OAuth providers

**Trigger:** users complain about creating yet another password.

**Recipe:** in `lib/auth.ts`, uncomment the Google provider stub. Set
`AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` as Vercel env vars (create the
OAuth client at https://console.cloud.google.com/apis/credentials).

Other providers (GitHub, Microsoft, Apple): https://authjs.dev/getting-started/providers

**Cost:** free (Google + GitHub OAuth are free; some are paid).

---

## 10. Horizontal scaling guards

**Trigger:** more than one Vercel function instance is running concurrently
(implicit at any nonzero traffic on Vercel) AND the rate limiter or cache
matters.

The shipped in-memory rate limiter is **correct and sufficient on a single
instance**. Only add Upstash once more than one instance can run concurrently —
otherwise each instance keeps its own counter and the effective limit multiplies.

**Recipe:** replace `lib/rate-limit.ts` (in-memory) with
`@upstash/ratelimit`:

```sh
npm install @upstash/ratelimit @upstash/redis
```

Sign up at https://upstash.com → create a Redis DB → copy
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` into Vercel env vars.

Swap `rateLimit()` for `Ratelimit.slidingWindow()`. Keep the same wrapper
interface so call sites don't change.

**Cost:** free 10k commands/day.

---

## Decision rule

Default position: **don't add until the user describes the symptom**. The
prototype rail is about speed; every dependency added is a future
maintenance cost the IT team inherits at `/handoff`.

Before adding any runtime dep > 50 KB minified, or one that contradicts the
locked stack, **check ADR-001** (the locked stack). A dependency that swaps or
fights a locked choice needs a **superseding ADR written first** — don't slip it
in via a recipe.

When in doubt, ask: "Is this for validation, or for the IT team's
production version?" If validation, add it. If production, defer to the
IT team's setup at handoff.
