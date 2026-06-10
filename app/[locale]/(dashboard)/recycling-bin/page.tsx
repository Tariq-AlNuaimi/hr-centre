"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Space, Tag, App } from "antd";
import {
  UndoOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useNotify } from "@/hooks/use-notify";
import { useSession } from "next-auth/react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { apiClient } from "@/lib/api-client";

interface DeletedItem {
  entityType: string;
  id: string;
  displayName: string;
  deletedAt: string;
  deletedBy: string | null;
}

// Envelope returned by the paginated GET /api/recycling-bin.
interface RecyclingBinResponse {
  data: DeletedItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

export default function RecyclingBinPage() {
  const t = useTranslations("recyclingBin");
  const tCommon = useTranslations("common");
  const { success, error: showError } = useNotify();
  const { modal } = App.useApp();
  const { data: session } = useSession();
  // types/index.ts augments next-auth's Session.user with role: Role,
  // so this access is typed -- no `as any` needed.
  const isAdmin = session?.user?.role === "ADMIN";

  const [items, setItems] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);

  const fetchItems = useCallback(
    async (nextPage: number, nextPageSize: number) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(nextPageSize),
        }).toString();
        // apiClient unwraps the `ApiResponse` envelope, so this is the inner
        // paginated payload (`{ data, total, page, pageSize }`).
        const res = await apiClient.get<RecyclingBinResponse>(
          `/api/recycling-bin?${qs}`
        );
        setItems(res.data ?? []);
        setTotal(res.total ?? 0);
        setPage(res.page ?? nextPage);
        setPageSize(res.pageSize ?? nextPageSize);
      } catch {
        showError(t("loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [showError, t]
  );

  useEffect(() => {
    fetchItems(page, pageSize);
    // Initial load only; subsequent loads go through handlers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePageChange = (nextPage: number, nextPageSize: number) => {
    fetchItems(nextPage, nextPageSize);
  };

  const handleRestore = async (item: DeletedItem) => {
    try {
      await apiClient.post("/api/recycling-bin", {
        entityType: item.entityType,
        id: item.id,
      });
      success(t("restored", { name: item.displayName }));
      fetchItems(page, pageSize);
    } catch {
      showError(t("restoreFailed"));
    }
  };

  const handlePermanentDelete = (item: DeletedItem) => {
    modal.confirm({
      title: t("permanentDeleteConfirm"),
      icon: <ExclamationCircleOutlined />,
      okType: "danger",
      okText: t("permanentDelete"),
      cancelText: tCommon("cancel"),
      async onOk() {
        try {
          await apiClient.delete(
            `/api/recycling-bin/${item.entityType}/${item.id}`
          );
          success(t("permanentlyDeleted", { name: item.displayName }));
          fetchItems(page, pageSize);
        } catch {
          showError(t("deleteFailed"));
        }
      },
    });
  };

  const columns = [
    {
      title: t("entityType"),
      dataIndex: "entityType",
      key: "entityType",
      render: (val: string) => <Tag>{val}</Tag>,
    },
    {
      title: t("name"),
      dataIndex: "displayName",
      key: "displayName",
    },
    {
      title: t("deletedAt"),
      dataIndex: "deletedAt",
      key: "deletedAt",
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: t("deletedBy"),
      dataIndex: "deletedBy",
      key: "deletedBy",
      render: (val: string | null) => val ?? "-",
    },
    {
      title: tCommon("actions"),
      key: "actions",
      render: (_: unknown, record: DeletedItem) => (
        <Space>
          {/* Restore + permanent delete are both ADMIN-only (POST/DELETE are
              withAdminAuth); don't show buttons that would 403 for non-admins. */}
          {isAdmin && (
            <Button
              icon={<UndoOutlined />}
              aria-label={t("restoreAction")}
              onClick={() => handleRestore(record)}
            >
              {t("restore")}
            </Button>
          )}
          {isAdmin && (
            <Button
              danger
              icon={<DeleteOutlined />}
              aria-label={t("permanentDeleteAction")}
              onClick={() => handlePermanentDelete(record)}
            >
              {t("permanentDelete")}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      <DataTable<DeletedItem>
        dataSource={items}
        columns={columns}
        loading={loading}
        rowKey={(r) => `${r.entityType}-${r.id}`}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        emptyText={t("empty")}
      />
    </>
  );
}
