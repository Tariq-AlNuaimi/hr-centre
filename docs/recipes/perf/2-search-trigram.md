# Recipe: Fast `ILIKE` / `contains` search with `pg_trgm` GIN indexes

> `/scale-up` → perf optimization **O4**.
> Makes the substring search the template already does (`{ contains, mode:
"insensitive" }`) fast at volume by adding `pg_trgm` GIN trigram indexes on the
> searched columns.

## The problem this fixes

The shipped list search (e.g. `app/api/users/route.ts`) builds:

```ts
const where: Prisma.UserWhereInput = {
  OR: [
    { name: { contains: search, mode: "insensitive" } },
    { email: { contains: search, mode: "insensitive" } },
  ],
};
```

Prisma compiles `contains` + `mode: "insensitive"` to `col ILIKE '%search%'`. A
**leading-wildcard `ILIKE`** cannot use a normal B-tree index, so Postgres falls
back to a **sequential scan** — it reads every row in the table on every search.
On the seed data (a handful of users) that's invisible; at a few hundred thousand
rows it's the slowest query on the page.

`pg_trgm` builds a **GIN index over the 3-character substrings (trigrams)** of a
column. `col ILIKE '%foo%'` and `col % 'foo'` (similarity) can then use the index
instead of scanning — turning the seq scan into an index scan.

## When to add it

Add this when **both** are true:

- A list page's search is over a table that has grown past ~50k rows (or `EXPLAIN
ANALYZE` on the search query shows `Seq Scan` + a climbing execution time).
- The searched columns are free-text the user types fragments of (names, emails,
  titles, descriptions) — not enum/FK columns (those should be exact-match filters
  with ordinary indexes, like the `role` filter already is).

**Don't** add it preemptively to a prototype with seed-scale data — the index has a
write-time and storage cost, and a seq scan over 50 rows is free. This is a
"search got slow" fix, not a default.

## Deps

None. `pg_trgm` is a **contrib extension bundled with Postgres 17** (and available
on Neon — see caveat). Pure SQL in a Prisma migration; no npm package, no app-code
change.

## Which columns

Index exactly the columns that appear inside a `contains` in a `where` builder.
For the shipped `users` search that's `name` and `email`. For a scaffolded entity,
it's whatever columns its API route ORs together in search. **One GIN index per
searched column.**

Do **not** trigram-index:

- Enum / boolean / FK columns (use ordinary B-tree; they're exact-match).
- Restricted columns you would never search (no need to widen their index surface).

## The migration

Create an empty migration and paste the SQL (touches `prisma/migrations` →
**Ask-before** per CLAUDE.md):

```bash
npx prisma migrate dev --create-only --name trgm_search_indexes
# edit prisma/migrations/<ts>_trgm_search_indexes/migration.sql with the block below
npx prisma migrate dev   # apply locally
```

```sql
-- prisma/migrations/<ts>_trgm_search_indexes/migration.sql
-- Trigram GIN indexes so `ILIKE '%x%'` search (Prisma `contains`/`mode:insensitive`)
-- uses an index instead of a sequential scan at volume (recipe perf/2).

-- 1. Enable the extension once per database. Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. One GIN trigram index per searched column. `gin_trgm_ops` is what makes the
--    index usable by ILIKE / LIKE / % (similarity).
CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (email gin_trgm_ops);

-- Add one pair of lines per searched column on any other audited entity, e.g.:
-- CREATE INDEX IF NOT EXISTS projects_title_trgm_idx
--   ON projects USING gin (title gin_trgm_ops);
```

> **No Prisma schema change is needed.** Prisma's `@@index` does not express
> `gin_trgm_ops`, so this index lives only in the migration SQL — that's expected
> and supported (raw-SQL index in a migration). `prisma migrate diff` /
> `prisma db pull` will not round-trip it; leave a comment in `schema.prisma` near
> the model noting "search trigram indexes live in migration `<ts>_trgm_search_indexes`"
> so a later `prisma migrate dev` doesn't surprise you. The index has no effect on
> generated client types.

### Optional: build the index without locking writes

`CREATE INDEX` takes a write lock on the table for the duration of the build. On a
large live table use `CONCURRENTLY` to avoid blocking writes:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);
```

`CREATE INDEX CONCURRENTLY` **cannot run inside a transaction**, and Prisma wraps
each migration in one. If you need `CONCURRENTLY`, run that statement by hand
against the DB (psql) _outside_ the migration, or split it into its own migration
and disable the wrapping transaction by putting the statement alone in the file and
applying it via `prisma db execute` rather than `migrate`. For a prototype the
plain (locking) `CREATE INDEX` during a low-traffic deploy is almost always fine.

## Neon caveat

- `pg_trgm` **is available on Neon** (it's in their allowed-extensions list), so
  `CREATE EXTENSION pg_trgm;` succeeds without a support ticket.
- `vercel.json` runs `prisma migrate deploy` on every build, so the extension +
  indexes are created automatically on the next deploy. The `CREATE EXTENSION IF
NOT EXISTS` is idempotent — safe to re-run.
- On Neon's **autoscaling free tier** the compute may be cold; the _first_ search
  after a scale-to-zero pays a cold-start regardless of the index. The index helps
  warm steady-state latency, not cold start.
- Neon branches inherit extensions from their parent at branch-creation time; a
  branch created _before_ this migration won't have the extension until the
  migration runs on it.

## No app-code change

The `where` builder stays exactly as it is — `contains` + `mode: "insensitive"`
already emits the `ILIKE` the index serves. The query planner picks the index up
automatically once it exists. This is the appeal: a pure-infra speedup with zero
risk to the route logic, the sort allowlist, or the auth wrapper.

> If you later want **ranked / fuzzy** results (typo tolerance, "closest match
> first"), switch the `where` to a raw similarity query — `prisma.$queryRaw`with a
> parameter placeholder (never `$executeRawUnsafe` on user input, per CLAUDE.md),
> e.g. `WHERE name % $1 ORDER BY similarity(name, $1) DESC`. The same GIN index
> serves the `%` operator. That's a larger change (you leave the typed `where`
> builder) — only do it if exact-substring search isn't enough.

## How to test

1. **Before:** with a populated table, run in psql:
   `EXPLAIN ANALYZE SELECT * FROM users WHERE name ILIKE '%ali%';` → expect
   `Seq Scan on users`.
2. Apply the migration (`npm run prisma:migrate`).
3. **After:** re-run the same `EXPLAIN ANALYZE` → expect a `Bitmap Index Scan on
users_name_trgm_idx` (Postgres only switches to the index when the table is big
   enough to make it cheaper — on a tiny seed table it may still choose a seq scan,
   which is correct; test against realistic volume, e.g. seed 100k rows).
4. The app's search returns the **same results** as before (this only changes the
   plan, not the semantics).
5. `npm test` (no contract touches this) and `/ship`.

## Rollback

```sql
DROP INDEX IF EXISTS users_name_trgm_idx;
DROP INDEX IF EXISTS users_email_trgm_idx;
-- Drop the extension only if nothing else uses it:
-- DROP EXTENSION IF EXISTS pg_trgm;
```

as a new migration (or revert the migration before it's deployed). No app code to
revert — the `where` builder never changed.

## Files to change in a fork

| File                                                       | Change                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `prisma/migrations/<ts>_trgm_search_indexes/migration.sql` | **New** — the SQL above; **Ask-before** (touches `prisma/migrations`)   |
| `prisma/schema.prisma`                                     | (optional) a comment near each searched model pointing at the migration |

Nothing under `lib/`, no route change, no new dependency.
