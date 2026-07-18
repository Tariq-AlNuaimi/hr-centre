"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import type { ColumnsType } from "@/components/shared/table-types";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { useEntityList, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";

function PlusIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

type ColumnFactory<T> = (args: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) => ColumnsType<T>;

/**
 * Generic list page for a simple CRUD entity — search + sort + paginate + delete +
 * "New" over the shipped `DataTable`/`useEntityList`/`useEntityMutations` primitives.
 * Each entity's page collapses to a ~6-line call passing its `apiPath`, `basePath`
 * (the route segment), a scoped `t`, and its columns factory (build-vs-buy ledger,
 * 2026-07-18). Entities needing extra list features (column filters, import) keep a
 * bespoke page.
 */
export function EntityListPage<T extends { id: string }>({
  apiPath,
  basePath,
  t,
  buildColumns,
}: {
  apiPath: string;
  basePath: string;
  t: (key: string) => string;
  buildColumns: ColumnFactory<T>;
}) {
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
  };

  const { data, isLoading } = useEntityList<T>(apiPath, params, t("loadFailed"));
  const { remove } = useEntityMutations<T>(apiPath);

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      success(t("deleted"));
    } catch {
      showError(t("deleteFailed"));
    }
  };

  const columns = buildColumns({
    onEdit: (id) => router.push(`/${locale}/${basePath}/${id}`),
    onDelete: handleDelete,
    t,
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button onClick={() => router.push(`/${locale}/${basePath}/new`)}>
            <PlusIcon />
            {t("createNew")}
          </Button>
        }
      />
      <DataTable<T>
        columns={columns}
        dataSource={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => {
          setPage(p);
          setPageSize(ps);
        }}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        searchable
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        emptyText={
          <EmptyState
            actionLabel={t("createNew")}
            onAction={() => router.push(`/${locale}/${basePath}/new`)}
          />
        }
      />
    </>
  );
}
