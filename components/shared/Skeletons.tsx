import { Skeleton } from "@/components/ui/skeleton";

/**
 * Layout-matched loading states (ADR-029, Workstream C2 — shadcn/Tailwind
 * rebuild, same exports/props). A loading screen should be the *silhouette* of
 * the screen that's coming, not a centered spinner or a generic grey block — so
 * content doesn't jump when it arrives and the user sees structure immediately.
 *
 * Every skeleton's header mirrors <PageHeader> (title block inline-start,
 * optional action inline-end, the same mb-4 bottom gap), so the page keeps its
 * shape across the load. Use these in route loading.tsx files AND in in-component
 * `if (loading) …` returns. Elements carry data-slot hooks for tests.
 */

function HeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <Skeleton data-slot="skeleton-title" className="h-8 w-44" />
      {withAction ? <Skeleton data-slot="skeleton-button" className="h-9 w-28" /> : null}
    </div>
  );
}

/** Generic page: header + N paragraph rows. The catch-all (route loading.tsx). */
export function PageSkeleton({
  rows = 6,
  withAction = false,
}: {
  rows?: number;
  withAction?: boolean;
}) {
  return (
    <div>
      <HeaderSkeleton withAction={withAction} />
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton
            key={i}
            data-slot="skeleton-line"
            className="h-4"
            style={{ width: i === rows - 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    </div>
  );
}

/** A list screen: header + primary action + table-shaped rows. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <HeaderSkeleton withAction />
      <div className="overflow-hidden rounded-md border border-border">
        <Skeleton data-slot="skeleton-row" className="h-11 rounded-none bg-muted/70" />
        <div className="flex flex-col gap-px">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} data-slot="skeleton-row" className="h-12 rounded-none" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A form screen: header + stacked field rows + submit button. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div>
      <HeaderSkeleton />
      <div className="flex max-w-md flex-col gap-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton data-slot="skeleton-input" className="h-9 w-full" />
          </div>
        ))}
        <Skeleton data-slot="skeleton-button" className="h-9 w-28" />
      </div>
    </div>
  );
}
