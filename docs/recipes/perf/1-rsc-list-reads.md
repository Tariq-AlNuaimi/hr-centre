# Recipe: RSC list reads (server-rendered tables, client island for interactivity)

> `/scale-up` → perf optimization **O1**.
> Converts a client-fetch list page (the canonical example is
> `app/[locale]/(dashboard)/users/page.tsx`) into a **React Server Component** that
> reads Prisma directly with `searchParams`, rendering a small **client island** for
> the interactive `DataTable`.

## When to add it

Add this when a list page is the first thing the team waits on and the network
waterfall is visible:

- The page mounts, *then* the browser fetches `/api/<resource>` (a second
  round-trip after the HTML), *then* the table fills in — a client waterfall that
  shows a spinner on every navigation.
- You want less JavaScript shipped (no `use-crud` fetch loop, no client-side data
  state for the initial render).
- The list is read-heavy and the filters are shareable/bookmarkable (search, sort,
  page belong in the URL anyway).

**Don't bother** for a tiny admin-only list that loads instantly, or a page whose
data is intrinsically client-driven (live polling, optimistic-heavy editing). The
template's shipped `users` page is deliberately the client-fetch pattern so both
styles have a reference — this recipe is the *opt-in* alternative, not a mandate.

The dashboard (`app/[locale]/(dashboard)/page.tsx`) is already the canonical RSC
read example (it imports `@/lib/prisma` directly and queries on the server). This
recipe extends that pattern to a *paginated, sortable, searchable* list.

## Deps

None. Everything used here (`@/lib/prisma`, `parsePagination`, `next/navigation`,
AntD `DataTable`) already ships in the base.

## How it works

- **Server page** (`page.tsx`, no `"use client"`) reads `searchParams`
  (`page` / `pageSize` / `sort` / `order` / `search` / `role`), runs the **same**
  Prisma query the API route runs — preserving the **sort allowlist** and
  pagination clamp — and passes the rows + total to a client island as props. No
  API round-trip, no client fetch, no initial spinner.
- **Client island** (`UsersTableClient.tsx`, `"use client"`) renders the
  interactive `DataTable` and, on sort/page/search/filter change, **pushes the new
  URL** via `useRouter().replace(...)`. Changing the URL re-runs the server
  component with new `searchParams`, which re-queries and re-renders. The island
  holds *no* data state — the URL is the single source of truth.

## The code

### 1. Server page — `app/[locale]/(dashboard)/users/page.tsx`

> This **replaces** the shipped client `users/page.tsx`. Keep a copy of the old
> file if you want to be able to revert (see Rollback).

```tsx
// React Server Component (no "use client"). Reads Prisma directly on the server
// from searchParams, renders a client island for the interactive table.
import { Typography, Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { parsePagination } from "@/lib/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { UsersTableClient } from "@/components/users/UsersTableClient";

const { Title } = Typography;

// Same allowlist as app/api/users/route.ts — prevents raw column injection via
// ?sort=. Keep the two in lock-step (or extract to a shared const).
const SORTABLE_COLUMNS = ["name", "email", "role", "createdAt", "lastLoginAt"] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];
const VALID_ROLES = ["ADMIN", "EDITOR", "VIEWER"] as const;

// searchParams flows from the URL; recompute on every request.
export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise in server components.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("users");
  const sp = await searchParams;

  // Build a URLSearchParams so we can reuse parsePagination unchanged.
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") usp.set(k, v);
  }
  const pagination = parsePagination(usp);

  const search = typeof sp.search === "string" ? sp.search : undefined;

  const sortParam = typeof sp.sort === "string" ? sp.sort : undefined;
  const sortField: SortableColumn =
    sortParam && (SORTABLE_COLUMNS as readonly string[]).includes(sortParam)
      ? (sortParam as SortableColumn)
      : "createdAt";
  const order: "asc" | "desc" = sp.order === "asc" ? "asc" : "desc";

  const roleParam = typeof sp.role === "string" ? sp.role : undefined;
  const role =
    roleParam && (VALID_ROLES as readonly string[]).includes(roleParam)
      ? roleParam
      : undefined;

  const where: Prisma.UserWhereInput = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(role ? { role: role as Prisma.UserWhereInput["role"] } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: order },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Serialize Dates to ISO strings before crossing the server→client boundary.
  const rows = data.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <>
      <Space
        style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}
      >
        <Title level={2} style={{ margin: 0 }}>
          {t("title")}
        </Title>
        {/* Plain link, not an onClick router.push — keeps this header server-rendered. */}
        <Link href="users/new">
          <Button type="primary" icon={<PlusOutlined />}>
            {t("createUser")}
          </Button>
        </Link>
      </Space>

      <UsersTableClient
        rows={rows}
        total={total}
        page={pagination.page}
        pageSize={pagination.pageSize}
        sort={sortField}
        order={order}
        search={search ?? ""}
        role={role}
      />
    </>
  );
}
```

> **Auth note.** The shipped `/api/users` route is `withAdminAuth` (the user
> directory is ADMIN-only — SECURITY.md §3). An RSC reads Prisma directly, so it
> **bypasses** that wrapper — you must gate the RSC yourself, exactly as
> `app/[locale]/(dashboard)/page.tsx` does:
>
> ```tsx
> import { auth } from "@/lib/auth";
> // ...at the top of the component:
> const session = await auth();
> if (session?.user?.role !== "ADMIN") notFound(); // import { notFound } from "next/navigation"
> ```
>
> Do this for any RSC that reads data the API route restricts. The RSC is a new
> read surface — re-apply the same role/row-level check the route had. (CLAUDE.md:
> "Adding a new public path or route → Ask before"; an RSC read is the same class
> of decision.)

### 2. Client island — `components/users/UsersTableClient.tsx`

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { getUserColumns } from "@/components/users/UserColumns";
import { useNotify } from "@/hooks/use-notify";
import { useCrud } from "@/hooks/use-crud";

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Props {
  rows: UserRecord[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  order: "asc" | "desc";
  search: string;
  role?: string;
}

export function UsersTableClient({
  rows,
  total,
  page,
  pageSize,
  sort,
  order,
  search,
  role,
}: Props) {
  const t = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const { success, error: showError } = useNotify();
  // Mutations still go through the API route (withAdminAuth) — UI → API → service
  // → Prisma. Only the READ moved into the RSC.
  const { remove } = useCrud<UserRecord>({ basePath: "/api/users" });

  // Push a new URL (merging with existing params). The RSC re-runs with the new
  // searchParams and re-renders the table. startTransition keeps the old rows
  // visible (no flash) while the server query is in flight.
  function pushParams(next: Record<string, string | undefined>) {
    const usp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "") usp.delete(k);
      else usp.set(k, v);
    }
    startTransition(() => router.replace(`?${usp.toString()}`, { scroll: false }));
  }

  async function handleDelete(id: string) {
    try {
      await remove(id);
      success(t("deleted"));
      // Re-fetch the server data by refreshing the route.
      startTransition(() => router.refresh());
    } catch {
      showError(t("deleteFailed"));
    }
  }

  const columns = getUserColumns({
    onEdit: (id) => router.push(`/${locale}/users/${id}`),
    onDelete: handleDelete,
    t,
  });

  return (
    <DataTable<UserRecord>
      columns={columns}
      dataSource={rows}
      loading={isPending}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={(p, ps) => pushParams({ page: String(p), pageSize: String(ps) })}
      onSortChange={(s: SortChange) =>
        pushParams({
          sort: s.field,
          order: s.order ? (s.order === "ascend" ? "asc" : "desc") : undefined,
          page: "1",
        })
      }
      onFilterChange={(filters) => {
        const roleFilter = filters.role;
        pushParams({
          role:
            roleFilter && roleFilter.length > 0 ? String(roleFilter[0]) : undefined,
          page: "1",
        });
      }}
      searchable
      onSearch={(value) => pushParams({ search: value || undefined, page: "1" })}
      emptyText={
        <EmptyState
          actionLabel={t("createUser")}
          onAction={() => router.push(`/${locale}/users/new`)}
        />
      }
    />
  );
}
```

> The current `DataTable`'s search input is uncontrolled local state, so it fires
> `onSearch` on every keystroke. For an RSC page that re-queries the server, debounce
> the push (wrap the `pushParams({ search })` call in a 300 ms debounce) so you don't
> issue a server round-trip per character. A tiny `useDebouncedCallback` is enough; no
> new dep needed.

## The perf win (and the trade-off)

**Win:**
- **No client waterfall.** The HTML arrives with the first page of rows already
  rendered — no mount-then-fetch spinner on navigation.
- **Less JavaScript.** The data-fetch loop (`useEffect` + `useCrud` list + the
  rows/total/page/search/sort state) no longer ships for the initial render; the
  island is small.
- **Cacheable / shareable URLs.** Filters live in the URL, so a teammate can paste
  the link and see the same filtered list.

**Trade-off:**
- **Interactivity moves to URL params.** Every sort/page/search is a server
  round-trip (mitigated by `startTransition` keeping old rows visible). For a
  rapid-fire, type-to-filter experience over a small dataset, the client-fetch
  version can feel snappier. Debounce search to keep round-trips sane.
- **Two files instead of one** (server page + client island) and a manual
  server↔client serialization step (Dates → ISO strings).
- **You must re-apply auth in the RSC** — the API wrapper no longer guards the read
  (see the auth note above). This is the most important correctness point.

## Files to change in a fork

| File | Change |
|---|---|
| `app/[locale]/(dashboard)/<entity>/page.tsx` | Replace the client list page with the server page above |
| `components/<entity>/<Entity>TableClient.tsx` | **New** — the client island |
| (keep) `components/<entity>/<Entity>Columns.tsx` | unchanged — reused by the island |
| (keep) `app/api/<entity>/route.ts` | unchanged — still serves mutations + any non-RSC consumers |

Nothing under `lib/`, no config, no schema change.

## How to test

1. Load `/en/users?sort=email&order=asc&page=2` directly → the table renders
   server-side already on page 2, sorted by email, **no spinner flash**. View
   source: the first rows are in the initial HTML.
2. Click a column sort / change page / type in search → the URL updates and the
   table re-renders; old rows stay visible during the transition.
3. **Sort allowlist holds:** `?sort=passwordHash` → falls back to `createdAt`
   (the allowlist rejected it), same as the API route.
4. **Auth holds:** sign in as VIEWER/EDITOR and hit `/en/users` → `notFound()` (or
   your chosen gate) fires; the directory is not leaked.
5. `npm run uat` still passes the `users` screen (it asserts the page loads and
   doesn't bounce to login).
6. `/ship`.

## Rollback

Restore the original client `users/page.tsx` (revert the file) and delete
`components/users/UsersTableClient.tsx`. The API route was never changed, so the
client-fetch path works immediately. No migration, no config to undo.

## Relation to `/scaffold-entity`

This is the shape a future `/scaffold-entity --rsc` mode would emit instead of the
client-fetch list page: a server `page.tsx` that reads Prisma from `searchParams`
plus a `<Entity>TableClient` island. Until that flag exists, apply this recipe by
hand to the pages where the waterfall actually hurts.
