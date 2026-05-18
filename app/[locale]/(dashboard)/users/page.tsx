"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Button, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
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
  const pathname = usePathname();
  const { success, error: showError } = useNotify();
  const { list, remove, loading } = useCrud<UserRecord & { id: string }>({
    basePath: "/api/users",
  });

  const locale = pathname.startsWith("/ar") ? "ar" : "en";

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  const fetchUsers = useCallback(async () => {
    try {
      const result = await list({
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
      });
      setUsers(result.data as unknown as UserRecord[]);
      setTotal(result.total);
    } catch {
      showError("Failed to load users");
    }
  }, [page, pageSize, search, list, showError]);

  // Standard "fetch on mount + when deps change" pattern. fetchUsers is a
  // useCallback that internally calls setState; the lint rule traces the
  // chain through the callback. SWR/React Query would replace this, but is
  // out of scope for the template baseline.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers();
  }, [fetchUsers]);

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
      success("User deleted");
      fetchUsers();
    } catch {
      showError("Failed to delete user");
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
        loading={loading}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => {
          setPage(p);
          setPageSize(ps);
        }}
        searchable
        onSearch={setSearch}
      />
    </>
  );
}
