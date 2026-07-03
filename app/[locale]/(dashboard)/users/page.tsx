"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { getUserColumns } from "@/components/users/UserColumns";
import { useEntityList, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function UsersPage() {
  const t = useTranslations("users");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const [role, setRole] = useState<string>();

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
    ...(role ? { role } : {}),
  };

  // Declarative data layer (ADR-021): the query caches + keeps the previous page
  // visible while a new page/search/sort loads, and the delete mutation
  // invalidates the list so it refetches itself -- no manual fetch/setState.
  // Read failures toast via the QueryProvider's cache-level onError (the message
  // passed here), so we don't hand-roll an error effect per page.
  const { data, isLoading } = useEntityList<UserRecord>(
    "/api/users",
    params,
    t("loadFailed")
  );
  const { remove } = useEntityMutations<UserRecord>("/api/users");

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      success(t("deleted"));
    } catch {
      showError(t("deleteFailed"));
    }
  };

  const columns = getUserColumns({
    onEdit: (id) => router.push(`/${locale}/users/${id}`),
    onDelete: handleDelete,
    t,
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button onClick={() => router.push(`/${locale}/users/new`)}>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("createUser")}
          </Button>
        }
      />

      <DataTable<UserRecord>
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
          const roleFilter = filters.role;
          setRole(
            roleFilter && roleFilter.length > 0
              ? String(roleFilter[0])
              : undefined
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
            actionLabel={t("createUser")}
            onAction={() => router.push(`/${locale}/users/new`)}
          />
        }
      />
    </>
  );
}
