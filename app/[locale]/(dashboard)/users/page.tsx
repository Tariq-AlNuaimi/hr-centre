"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { getUserColumns } from "@/components/users/UserColumns";
import { useCrud } from "@/hooks/use-crud";
import { useNotify } from "@/hooks/use-notify";

const { Title } = Typography;

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
  const { list, remove, listLoading } = useCrud<UserRecord & { id: string }>({
    basePath: "/api/users",
  });

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const [role, setRole] = useState<string>();

  const fetchUsers = useCallback(async () => {
    try {
      const result = await list({
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
        ...(sort.field ? { sort: sort.field } : {}),
        ...(sort.order
          ? { order: sort.order === "ascend" ? "asc" : "desc" }
          : {}),
        ...(role ? { role } : {}),
      });
      setUsers(result.data as unknown as UserRecord[]);
      setTotal(result.total);
    } catch {
      showError(t("loadFailed"));
    }
  }, [page, pageSize, search, sort, role, list, showError, t]);

  // Standard "fetch on mount + when deps change" pattern. fetchUsers is a
  // useCallback that internally calls setState; the lint rule traces the
  // chain through the callback. SWR/React Query would replace this, but is
  // out of scope for the template baseline.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers();
  }, [fetchUsers]);

  const handleDelete = async (id: string) => {
    // Optimistic: drop the row immediately so the table never blanks behind a
    // full-table spinner. Re-sync (and restore on failure) via fetchUsers.
    const previous = users;
    setUsers((rows) => rows.filter((u) => u.id !== id));
    try {
      await remove(id);
      success(t("deleted"));
      fetchUsers();
    } catch {
      setUsers(previous);
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
      <Space
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          {t("title")}
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => router.push(`/${locale}/users/new`)}
        >
          {t("createUser")}
        </Button>
      </Space>

      <DataTable<UserRecord>
        columns={columns}
        dataSource={users}
        loading={listLoading}
        total={total}
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
