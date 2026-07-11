# ADR-021 — Client data layer: TanStack Query

**Status:** Accepted
**Date:** 2026-06-15
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-001 (locked stack, auth wrappers, zod boundary), ADR-012 (REST + zod over tRPC), ADR-013 (`apiClient` typing seam). Resolves senior-review finding #34.

## Context

Client CRUD pages fetched data with a hand-rolled pattern: the imperative
`useCrud` hook (`hooks/use-crud.ts`) wrapping `apiClient`, called inside a
`useEffect` that pushed results into per-page `useState`. Every list page
re-implemented the same loop — build query params, fetch, `setItems` /
`setTotal`, surface errors, and on delete an optimistic `setState` + manual
re-fetch. `useCrud` even grew its own `AbortController` dedup to stop a stale
list response from overwriting a fresher one (CHANGELOG, race fix).

That is a cache/state-management problem solved per page, by hand:

- **No caching or dedup across pages** — navigating back to a list refetches
  from scratch; two components wanting the same data fetch it twice.
- **Manual invalidation** — after a write, each page re-fetches explicitly; miss
  one and the UI goes stale.
- **Race handling is bespoke** — the abort dance lives in `useCrud` and is easy
  to get wrong when copied.
- **`set-state-in-effect` lint suppressions** litter the generated pages.

The senior review (#34) flagged adopting a real data layer. The prior session
deferred it as a >50 KB dependency needing an ADR (CLAUDE.md "Ask before");
this ADR is that gate.

## Market scan

- **TanStack Query (React Query) v5** — the de-facto React server-state library.
  Declarative `useQuery`/`useMutation`, query-key cache + invalidation,
  `keepPreviousData` pagination, automatic request cancellation via the
  `queryFn` `signal`, devtools. ~12–13 KB gzipped core, framework-agnostic
  transport (keeps our `apiClient` + `ApiResponse` envelope). Mature, heavily
  used, stable v5 API.
- **SWR** — lighter (~4–5 KB), Vercel-maintained, great for read caching. But
  mutations/invalidation are more manual, and the ergonomics for our
  list+detail+CRUD matrix are thinner than Query's `useMutation` + invalidate.
- **tRPC** — explicitly rejected in ADR-012 (we keep REST + zod so the `/api/v1`
  external seam and non-TS consumers stay first-class). Out of scope.
- **Keep hand-rolled `useCrud`** — zero deps, but every benefit above stays
  unbuilt and the race/invalidation logic stays copy-pasted into generated code.

**Trade-off:** TanStack Query costs the most bytes of the three but removes the
most per-page code and is the only option that gives caching **and** ergonomic
mutation-invalidation out of the box. For an internal dashboard where the
data-fetch boilerplate is the actual pain, that is the right call.

## Decision

**Adopt TanStack Query v5 as the client data layer.** It sits _on top of_ the
existing typed `apiClient` — the transport, the `ApiResponse`/`PaginatedResponse`
envelope, and the REST routes are unchanged. Server components keep hitting
Prisma directly; this is for the client CRUD pages only.

Pieces:

- **`components/providers/QueryProvider.tsx`** — a `QueryClientProvider` with one
  `QueryClient` per browser session (created in `useState`, never a module
  singleton, so SSR can't leak one user's cache into another). Defaults tuned for
  an internal tool: `staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: false`.
  Wired into `app/[locale]/layout.tsx` inside `AntdRegistry`, around
  `ThemeProvider`.
- **`hooks/use-entity-queries.ts`** — generic hooks parameterized by REST
  `basePath`: `useEntityList` (paginated, `keepPreviousData`), `useEntityItem`
  (detail, disabled until `id`), `useEntityMutations` (create/update/delete that
  invalidate the entity's cached lists + affected detail on success). A shared
  `entityKeys(basePath)` query-key factory keeps invalidation honest.
- **Reference migration** — the `users` list/new/edit pages now use these hooks.
- **Scaffolder** — `scripts/scaffold-entity.mjs` generates pages on the new
  hooks, so every future entity gets caching + invalidation for free and the
  `set-state-in-effect` suppressions are gone from generated code.
- **`useCrud` is `@deprecated`** — retained only for the RSC-list recipe
  (`docs/recipes/perf/1-rsc-list-reads.md`); removed once that recipe is updated.

## Consequences

- **Less per-page code; better UX.** Lists cache and keep the previous page
  visible while loading; writes invalidate and refetch automatically; the stale-
  response race is handled by the library, not by hand.
- **Bundle cost.** ~12–13 KB gzipped added to the client. Acceptable for the
  ergonomics; noted here per the Ask-before dependency rule.
- **Test harness.** `tests/components/_render.tsx` now wraps a fresh
  `QueryClient` (retry off) per render so component tests stay isolated.
- **No security-floor change.** Auth wrappers, zod-at-the-boundary, the
  UI→API→service→Prisma rule, and audit are untouched — this is a client
  transport/cache layer that calls the same gated routes.
- **Reversible.** Confined to the provider, the hooks file, and generated-page
  templates; `apiClient` and the routes are unchanged, so reverting is local.

## Alternatives considered

See the market scan: SWR (lighter, weaker mutations), tRPC (rejected by
ADR-012), and keeping `useCrud` (no caching/invalidation). TanStack Query won on
removing the most boilerplate while preserving the REST + zod + `apiClient`
stack the rest of the template depends on.
