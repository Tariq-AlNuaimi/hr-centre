---
name: stack-advisor
description: Build-time stack expert for this template's locked stack -- Next.js 16 RSC, Prisma 7, Postgres. Gives the framework-correct pattern for RSC data-fetching, a bounded/index-aware Prisma query, or a component while it's being written. Advice only, not a review of finished code (that's /code-review). Use while writing a route, query, or component -- the right way to fetch or query something.
---

# /stack-advisor — build it right, at build time

The review rail catches stack mistakes **after** they're written (`/code-review`
diff gate → `senior-code-reviewer` breadth pass). This skill is the **front** of
that rail: injected, framework-correct guidance the main session pulls in _while
building_ a route/query/component, so the code lands right the first time instead
of getting flagged at QA.

The stack is locked (ADR-001): **Next.js 16 (App Router, RSC) + Prisma 7 +
Postgres**, always used together — a route reads via Prisma against Postgres in
one server component. So this is **one composed advisor** across the three layers,
not three personas.

## Boundary (read this first — it's why this skill exists separately)

**I advise; I do not review.** This skill emits _positive patterns_ for the code
you're about to write. It does **not**:

- produce a severity-ranked review, lenses, or a findings list → that's
  `senior-code-reviewer` (post-push breadth) and `/code-review` (pre-push diff).
- restate the thirteen ESLint rules → they're enforced automatically at `error`; the
  lint output is the authority. This skill carries the _positive_ patterns the
  rules can't teach ("prefer an RSC read over a client fetch — here's the shape").
- re-document primitives → it **points at** `components/shared/*`, `lib/*`,
  `docs/design-recipes.md`, `docs/recipes.md`, and the ADRs.

If you catch yourself grading existing code, stop and route to `/code-review` or
`senior-code-reviewer`. If the right build proposes a new runtime dep > 50 KB,
raw SQL, or an Ask-before change (auth, `lib/prisma/*`, schema/migrations,
`middleware.ts`), **route it through the Ask-before gate** — advise the pattern,
don't advise around the guard.

## Layer 1 — Next.js 16 data fetching (RSC-first)

**Prefer a server-component read over a client `useEffect`/query fetch** whenever
the data is available at request time. The RSC reads directly (server component or
API route are the only things that touch `prisma` — `no-prisma-in-client`); the
client gets HTML, not a round-trip.

- **Read on the server, mutate through a route.** The data flow is **UI → API
  route → service → Prisma** (Hard rule). Server components read; forms/actions
  POST to a `withAuth`-wrapped route (`lib/api-helpers.ts`). Don't reach for a
  client fetch to render first paint — that's the client `useEffect` anti-pattern
  the RSC read replaces.
- **When you _do_ need client state** (mutations, optimistic UI, polling), the
  client data layer is TanStack Query (ADR-021), wired via `lib/api-client.ts` /
  `lib/query-error-notifier.ts` — not a hand-rolled `fetch` + `useState`.
- **Keep payloads bounded** at the RSC seam too: `select` only the columns the
  view renders; don't ship the whole row to the client.
- **UI comes from the vetted recipes**, built on the shipped primitives
  (`PageHeader`, `DataTable`, `EmptyState`, `Skeletons`, `ConfirmAction`,
  `Chart`, …). Load `/design-system` + `docs/design-recipes.md` for the markup;
  this skill covers the _data_ shape behind it. Every data surface ships its real
  empty/loading/error states — that's Pillar 5, not optional.

## Layer 2 — Prisma 7 query shape (Pillar 4: Scalable)

The reference shape is `app/api/users/route.ts` — copy its structure:

- **Every list/read route paginates.** Use `parsePagination` +
  `paginatedResponse` (`lib/pagination.ts`); it upper-clamps `page` and
  `pageSize` so a huge `?page=` can't produce an OFFSET that 500s. Never return an
  unbounded `findMany()` — the `/ship` scalability scan fails on it.
- **Count + page in one round-trip:** `await Promise.all([findMany(...),
count({ where })])`, sharing the same `where`. Don't fetch-all-then-slice.
- **`select` explicit columns — never `SELECT *`** (Hard rule). It bounds the
  payload and keeps Restricted columns out unless intended.
- **No N+1.** Pull relations with `include`/nested `select` in the single query,
  not a loop of per-row reads. Bulk paths use one bulk call, not N×1 — but a bulk
  write on an audited model bypasses the audit log (`no-unaudited-bulk-write`,
  ADR-010); if you need the audit trail, loop `update` inside a `$transaction` or
  keep the model out of the bulk path. Advise the audited shape.
- **Sort/filter from an allowlist**, like `SORTABLE_COLUMNS` in the users route —
  never interpolate a raw `?sort=` column into `orderBy`.
- **Respect the invariants:** `prisma` (not `prismaUnfiltered`) applies
  soft-delete + audit automatically (`lib/prisma/*`). `prismaUnfiltered` is
  allowlisted to auth/recycling-bin/maintenance only — proposing it in an
  ordinary route is an Ask-before change.
- **No raw SQL** except parameterized `$queryRaw`/`$executeRaw`; never
  `$executeRawUnsafe` on user input (`no-raw-sql-unsafe`, OWASP A03).

## Layer 3 — Postgres access patterns

- **Index the columns you filter/sort/join on.** The users route filters `name`/
  `email`/`role` and sorts `createdAt`/`lastLoginAt` — those access paths want
  supporting indexes in `schema.prisma` (`@@index`) so the query stays index-aware
  as rows grow. Advise the index alongside the query; a schema/migration change is
  Ask-before, so surface it, keep migrations small and forward-compatible
  (`vercel.json` runs `migrate deploy` every build — never drop a column the
  running version still reads).
- **Text search:** `contains` + `mode: "insensitive"` is the template default (see
  users route). Fine for prototype scale; if a search surface outgrows it, that's a
  `/scale-up` conversation (Postgres FTS / trigram), not an ad-hoc rewrite.
- **Bound the result set at the DB, not in JS** — pagination `skip`/`take` pushes
  the limit into the `OFFSET/LIMIT`, so Postgres returns one page, not the table.

## Security floor (teach it, never bypass it)

Every route: an auth wrapper (`withAuth`/`withAdminAuth`/
`withInternalAuth`/`withApiAuth`) + zod validation at the boundary
(`lib/validations/*`, `.safeParse`). Compose `withRateLimit` **outside** the auth
wrapper (`no-rate-limit-inside-auth`). Never cast `session` to `any`. A Restricted
column extends `SCRUB_FIELDS` (audit) and is never an Excel export column key
(`no-restricted-export-column`). This skill _teaches_ the floor as part of the
right pattern — it doesn't route around it.

## Freshness

The stack is version-LOCKED (ADR-001) but the libraries move. Before advising on an API that may have
changed across versions, run **`/docs-current`** (V2-504) — it pulls the CURRENT docs for the pinned
version via the context7 MCP (Prisma 7 / Next 16 / Tailwind v4 / Auth.js / Playwright), with a
WebSearch fallback — so a build-time pattern is framework-correct for what the repo actually runs, not
a stale remembered signature.

## Verification

Before calling this done:

- [ ] The advice given points at this repo's real primitives (`lib/pagination.ts`, `lib/api-helpers.ts`, `lib/validations/*`, `app/api/users/route.ts`, `docs/design-recipes.md`) rather than a generic pattern
- [ ] Every route/query/component the advice touches keeps an auth wrapper + zod boundary validation and never casts `session` to `any`
- [ ] No advice proposes a new runtime dep > 50 KB, raw SQL, or an Ask-before change (auth, `lib/prisma/*`, schema/migrations, `middleware.ts`) without routing it through the Ask-before gate first
- [ ] The advice stayed advisory — no severity-ranked review or findings list was produced (that's `/code-review` / `senior-code-reviewer`)

**Emits:** nothing — this step leaves no receipt. It's advice only; it shapes the code as it's written and reviews nothing, so the durable artifact (if any) is whatever the resulting code/PR contains, not this skill itself.

## Related

- `/docs-current` — version-correct stack docs before answering (V2-504).
- `docs/recipes.md` / `docs/design-recipes.md` — the copy-paste code + design patterns.
- `app/api/users/route.ts` — the reference list-route shape (paginate + select + allowlist).
- `lib/pagination.ts`, `lib/api-helpers.ts`, `lib/validations/*` — the primitives to reuse.
- ADR-001 (locked stack), ADR-012 (REST+zod), ADR-021 (client data layer), ADR-010 (audit).
- `/code-review` (pre-push diff) · `senior-code-reviewer` (post-push breadth) — the **review** rail this skill is deliberately _not_.
