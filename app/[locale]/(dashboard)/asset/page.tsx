"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { getAssetColumns, type AssetRecord } from "@/components/asset/AssetColumns";
import { AssetImport } from "@/components/asset/AssetImport";
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

export default function AssetsPage() {
  const t = useTranslations("assets");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const [status, setStatus] = useState<string>();
  const [category, setCategory] = useState<string>();
  // Bumped after a bulk import to re-key the list query so it refetches (the API ignores `_r`).
  const [refreshNonce, setRefreshNonce] = useState(0);

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(refreshNonce ? { _r: String(refreshNonce) } : {}),
  };

  // Declarative data layer (ADR-021): the query caches + keeps the previous page
  // visible while a new page/search/sort loads, and the delete mutation
  // invalidates the list so it refetches itself -- no manual fetch/setState.
  // Read failures toast via the QueryProvider's cache-level onError (the message
  // passed here), so we don't hand-roll an error effect per page.
  const { data, isLoading } = useEntityList<AssetRecord>("/api/asset", params, t("loadFailed"));
  const { remove } = useEntityMutations<AssetRecord>("/api/asset");

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      success(t("deleted"));
    } catch {
      showError(t("deleteFailed"));
    }
  };

  const columns = getAssetColumns({
    onEdit: (id) => router.push(`/${locale}/asset/${id}`),
    onDelete: handleDelete,
    t,
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button onClick={() => router.push(`/${locale}/asset/new`)}>
            <PlusIcon />
            {t("createNew")}
          </Button>
        }
      />
      <DataTable<AssetRecord>
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
        onFilterChange={(filters) => {
          const statusFilter = filters.status;
          const categoryFilter = filters.category;
          setStatus(statusFilter && statusFilter.length > 0 ? String(statusFilter[0]) : undefined);
          setCategory(
            categoryFilter && categoryFilter.length > 0 ? String(categoryFilter[0]) : undefined,
          );
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
            actionVariant="outline"
            onAction={() => router.push(`/${locale}/asset/new`)}
          />
        }
      />
      <AssetImport onImported={() => setRefreshNonce((n) => n + 1)} />
    </>
  );
}
