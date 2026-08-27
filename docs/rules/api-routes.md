---
globs: app/api/**, lib/api-helpers.ts, lib/rate-limit.ts, lib/auth.ts, middleware.ts
title: API routes — auth wrappers, zod, rate limiting
---

# API-route rules

Loaded when you touch `app/api/**`. The constitution keeps the one-line floor; the wrapper table
and boundary detail live here.

## Hard rules (routes)

- **Use the auth wrappers** (`lib/api-helpers.ts`) on every route:
  - `withAuth` — any authenticated user.
  - `withAdminAuth` — ADMIN only.
  - _(`withEditorAuth` was removed by ADR-070 with the `EDITOR` enum value; there is no middle tier. `no-bare-api-route` now treats it as no wrapper at all.)_
  - `withInternalAuth` — shared-secret for schedulers; Vercel-Cron routes opt into
    `{ bearer: true, skipWhenUnconfigured: true }` (ADR-018).
  - `withApiAuth` — Bearer for machine consumers, the `/api/v1` seam (ADR-013).
  - Compose `withRateLimit` **OUTSIDE** the auth wrapper (`no-rate-limit-inside-auth` rule, OWASP
    A04 — floods throttled before auth work runs).
- **Validate at the API boundary with zod** (`lib/validations/`). **Never cast `session` to
  `any`** (`no-any-cast-on-session` rule; `types/index.ts` types `session.user.role`).
- **No bare internal routes** — `/api/internal/*` routes use `withInternalAuth`
  (`no-bare-internal-route` rule).

## Scalability (Scalable pillar, automatable slice)

List/read routes paginate or bound their result set; no N+1; bulk paths not N×1; rate-limit-aware.
`/ship`'s unbounded-query scan flags naked `findMany()` without `take`/`where` bounds.

## Ask before (route surface)

Touching `lib/api-helpers.ts`, `lib/rate-limit.ts`; adding a public path or `/api/internal/*`
route; bypassing any auth wrapper.
