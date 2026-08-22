---
name: scale-up
description: Adds a capability the prototype rail doesn't ship with -- file uploads, background jobs, cron, realtime, a custom domain, a bigger database, feature flags, or observability -- each with a when-to-add trigger and a recipe. Suggests, doesn't auto-install. Use when the project needs a new capability or is outgrowing the starter rail.
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
> flood is throttled _before_ any auth/handler work runs, not after. The correct
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

> **Querying the DB from a Claude Code web session?** Raw TCP `:5432` to Neon is
> firewalled; use the serverless driver (SQL over HTTPS/443): `make db-sql SQL="select 1"`
> (`scripts/neon-sql.mjs`, `@neondatabase/serverless` devDep). See
> `docs/runbooks/browser-egress-in-web-sessions.md` §Bonus.

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

## 11. Self-host / containerize (opt-in Docker rail)

**Trigger:** the project must run on-prem, air-gapped, or in k8s/ECS rather than
on Vercel — or IT wants a runnable image at `/handoff`.

**Recipe:** use the **`/docker`** skill. The rail already ships (ADR-023):
`Dockerfile`, `docker-compose.dev.yml`, and the `DOCKER_BUILD=1` gate in
`next.config.ts`. `make docker-build` → image; `make docker-up` → full local
stack. Vercel + Neon stays the default (ADR-006); this is additive, not a swap.

**Cost:** none (infra you already host). Don't re-enable `output: "standalone"`
unconditionally — it's gated so the Vercel build stays unchanged.

---

## 12. Live DB tuning — EXPLAIN + index advice (postgres-mcp)

**Trigger:** a deployed fork has real traffic and queries are slowing down —
you want EXPLAIN plans, index recommendations, or a live health check. The
static `/ship` scalability scan proves list reads are _bounded in source_; it
cannot see query plans, index usage, or N+1 as it actually executes
(`docs/deep-comparison/07-scalability.md`). This is the agent-driven runtime
complement.

**Recipe:** register [crystaldba/postgres-mcp](https://github.com/crystaldba/postgres-mcp)
as a session MCP server against the Neon URL, **always in restricted
(read-only, safety-checked) mode**:

```jsonc
// .mcp.json -- ADD to "mcpServers" for the tuning session:
"postgres": {
  "command": "uvx",
  "args": ["postgres-mcp", "--access-mode=restricted"],
  "env": { "DATABASE_URI": "<Neon DATABASE_URL>" }
}
```

The agent gets EXPLAIN-plan analysis (including hypothetical indexes via
`hypopg`), index tuning, and database-health checks (bloat, vacuum, unused /
duplicate indexes, connections). Rules:

- Never use `--access-mode=unrestricted` against a shared/production DB — an
  agent issuing writes would bypass Prisma, the audit extension, and
  soft-delete (same reason mindsdb-style direct SQL is banned).
- Land any recommended index as a Prisma migration (`@@index` in
  `prisma/schema.prisma` + `prisma migrate dev`) — never hand-`CREATE INDEX`
  on the live DB; the schema stays the source of truth.
- Remove the server from `.mcp.json` when the tuning session is done
  (`docs/mcp.md`; the token policy warns at >3 servers).

**Cost:** free (OSS; runs locally via `uvx`, needs Python + uv).

---

## 13. Load testing (k6 + k6-mcp-server)

**Trigger:** before sharing an app widely, or at `/handoff` — you want
empirical evidence that the deployed URL holds p95 latency and error-rate
under N concurrent users. `/ship`'s scan proves individual queries are
paginated; only generated load proves the _system_ handles growth.

**Recipe:** install the [k6](https://k6.io) binary (single Go binary; no npm
dep) and keep a smoke script in `tests/load/`:

```js
// tests/load/smoke.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 20 }, // ramp to 20 VUs
    { duration: "2m", target: 20 }, // hold
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // ms
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/en`);
  check(res, { "status 200": (r) => r.status === 200 });
}
```

Run: `k6 run -e BASE_URL=https://<fork-preview>.vercel.app tests/load/smoke.js`.
Target **preview** deployments, not production; authenticated routes need a
session-cookie setup step. Mind the rate limiter: loading an authed API route
past its limit is _supposed_ to return 429 — assert on that, don't "fix" it.

**Agent-driven (optional):** register
[QAInsights/k6-mcp-server](https://github.com/qainsights/k6-mcp-server)
(Python + uv + the local k6 binary) so Claude can launch runs and read
results itself:

```jsonc
// .mcp.json -- after cloning the k6-mcp-server repo locally:
"k6": {
  "command": "uv",
  "args": ["--directory", "/path/to/k6-mcp-server", "run", "k6_server.py"]
}
```

Session-scoped like #12 — remove it when done.

**Cost:** free (OSS binary; k6 Cloud/distributed runs are optional paid).

---

## 14. Postgres health dashboard (pghero)

**Trigger:** a fork has sustained real traffic and you want a _standing_ view
of slow queries, missing/unused/duplicate indexes, table bloat, and
connection counts — continuous symptom surfacing, where #12 is the on-demand,
agent-driven diagnosis/fix path.

**Recipe:** run the [ankane/pghero](https://github.com/ankane/pghero) Docker
image against the Neon URL — zero app-code change:

```sh
docker run -p 8080:8080 -e DATABASE_URL="$DATABASE_URL" ankane/pghero
# open http://localhost:8080
```

For slow-query stats, enable the extension once (available on Neon):

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Run it locally / on an internal box only. **Never deploy pghero publicly** —
it reads the whole database (Restricted data class, SECURITY.md §1) and ships
no auth of its own.

**Cost:** free (OSS Docker image).

---

## 15. Performance measurement (CWV, bundle, renders)

**Trigger:** you need Pillar-1 (Speed) _numbers_ instead of reviewer
judgement — Core Web Vitals from real users, what's actually in the client
bundle, which components re-render wastefully. This is the template's biggest
documented tooling gap (`docs/deep-comparison/12-performance.md`); everything
below bolts onto the Vercel host without restructuring.

Four layers, each independently opt-in:

**(a) Vercel Speed Insights — field + lab CWV, near zero-config.** Vercel
dashboard → project → Speed Insights → Enable, then:

```sh
npm install @vercel/speed-insights
```

```tsx
// app/[locale]/layout.tsx — render once inside <body>:
import { SpeedInsights } from "@vercel/speed-insights/next";
// ... <SpeedInsights />
```

Real-user LCP/INP/CLS from the exact audience the template targets
(stakeholders on shared `*.vercel.app` links), surfaced as a dashboard. Don't
hand-wire `web-vitals` — this is the same RUM productized for this host.
Cost: included on Hobby (bounded data points).

**(b) `@next/bundle-analyzer` — bundle treemap behind an env flag.**

```sh
npm install -D @next/bundle-analyzer
```

```ts
// next.config.ts
import bundleAnalyzer from "@next/bundle-analyzer";
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "1" });
export default withBundleAnalyzer(nextConfig);
```

`ANALYZE=1 npm run build` → interactive treemap. On-demand only, zero prod
impact. Makes the "Ask before a >50 KB dep" rule _visible_ (transitive bloat,
duplicated deps, mis-imported AntD chunks).

**(c) react-scan — dev-only re-render overlay.** No dependency needed:

```sh
npx react-scan@latest http://localhost:3000
```

Highlights components as they render and flags avoidable re-renders — aimed
exactly at the client islands (AntD tables, dnd-kit boards, recharts). Prefer
the CLI over installing it; if a fork wants it always-on in dev, add it as a
devDependency with a `NODE_ENV`-gated import. (Chosen over
`why-did-you-render` — same job, zero-config.)

**(d) Lighthouse-CI — scored audit of a preview URL.**

```sh
npx @lhci/cli autorun \
  --collect.url=https://<fork-preview>.vercel.app/en \
  --assert.assertions.categories:performance=0.9
```

Reproducible lab Performance score + CWV per deploy. Runs ad-hoc from any
machine today; wire it into the dormant CI as a per-PR assertion when Actions
activate. For interactive trace-level digging from a session, use
**chrome-devtools-mcp** instead (as-needed wiring: `docs/mcp.md`).

**Status vs the adoption program** (`docs/deep-comparison/ADOPT.md` — the
checklist of record; don't check items off from here):

- This section is the _documentation layer_ (Wave A3 docs subset). The actual
  installs — the Speed Insights component, the bundle-analyzer wrapper in
  `next.config.ts`, any react-scan devDependency — land in the **Wave A3 full
  pass** (dependency changes are out of scope for docs-only rounds).
- The **hard gates** built on these numbers are **Wave A1**, after the
  Workstream C replatform: `size-limit` bundle _budget_ and the coverage
  floor land as `/ship` phases there, not via this recipe.

**Cost:** all free (Speed Insights on Hobby; the rest OSS/dev-only).

---

## 16. Internal docs site (Fumadocs)

**Trigger:** the team needs browsable, searchable project documentation — the
guides in `content/docs/**` plus the ADR series — behind the app's login,
instead of reading Markdown on GitHub.

**Recipe (one command; the docs rail is pre-built, ADR-053):**

```sh
npm run enable:docs-site            # or -- --dry-run to preview
```

The enabler emits the verified docs surface (pages under `/{locale}/docs`, an
auth-gated `/api/docs-search` Orama route, `source.config.ts` MDX collections,
the `--color-fd-*` → app-token bridge so light/dark/RTL follow the app), patches
`next.config.ts`/`tsconfig.json`/`app/globals.css`/`knip.json`, and installs
`fumadocs-ui`/`fumadocs-core`/`fumadocs-mdx` (the Ask-before >50KB deps this
recipe pre-authorizes on operator approval). Authoring workflow: commit an
`.mdx` with `title` frontmatter → it's in the sidebar next build; ADRs are
ingested from `docs/decisions/` unchanged. Internal-only by default — the
public posture (remove the layout session check + add `/docs` to middleware
`publicPaths`) is documented in the emitted `content/docs/adding-pages.mdx`.

**Cost:** free (OSS). ~213kB gzip extra client chunk — an enabled fork stays
under the 1.2MB size-limit budget (918kB verified); MDX compile adds a few
seconds to `next build`.

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

## Verification

Before calling this done:

- [ ] The chosen capability matches a numbered item in this skill (its trigger and recipe were followed, not improvised)
- [ ] The operator explicitly confirmed before anything was installed — this skill suggests, it does not auto-install
- [ ] If a runtime dependency > 50 KB was added, it's reflected in `package.json`/`package-lock.json` and, if it contradicts the ADR-001 locked stack, a superseding ADR was written first
- [ ] Any new env var is added to `.env.example` (and `lib/env.ts`'s zod schema, where applicable)
- [ ] `npm run ship` still passes after the change

**Emits:** depends on the item chosen — this skill suggests rather than auto-installs, so the durable artifact (a new dependency, an env var, a `vercel.json` cron entry, a recipe file copied in, etc.) is whatever the operator approved and the recipe added, not something this skill leaves on its own.
