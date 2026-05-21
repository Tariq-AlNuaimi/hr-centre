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

**Trigger:** monthly audit-log purge, daily report email, hourly cleanup.

**Recipe:** edit `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "prisma generate && prisma migrate deploy && next build",
  "framework": "nextjs",
  "crons": [
    { "path": "/api/internal/audit-purge", "schedule": "0 3 1 * *" }
  ]
}
```

The route is already wrapped with `withInternalAuth`, so set
`AUDIT_PURGE_TOKEN` (32+ chars) as a Vercel env var and Vercel Cron will
pass it as the `Authorization: Bearer <token>` header automatically.

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

When in doubt, ask: "Is this for validation, or for the IT team's
production version?" If validation, add it. If production, defer to the
IT team's setup at handoff.
