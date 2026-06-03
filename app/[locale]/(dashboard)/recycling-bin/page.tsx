"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Table, Button, Space, Tag, App } from "antd";
import {
  UndoOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useNotify } from "@/hooks/use-notify";
import { useSession } from "next-auth/react";

const { Title } = Typography;

interface DeletedItem {
  entityType: string;
  id: string;
  displayName: string;
  deletedAt: string;
  deletedBy: string | null;
}

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

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recycling-bin");
      const json = await res.json();
      setItems(json.data ?? []);
    } catch {
      showError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleRestore = async (item: DeletedItem) => {
    try {
      const res = await fetch("/api/recycling-bin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: item.entityType,
          id: item.id,
        }),
      });
      if (!res.ok) throw new Error();
      success(t("restored", { name: item.displayName }));
      fetchItems();
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
          const res = await fetch(
            `/api/recycling-bin/${item.entityType}/${item.id}`,
            { method: "DELETE" }
          );
          if (!res.ok) throw new Error();
          success(t("permanentlyDeleted", { name: item.displayName }));
          fetchItems();
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
          <Button
            icon={<UndoOutlined />}
            aria-label={t("restoreAction")}
            onClick={() => handleRestore(record)}
          >
            {t("restore")}
          </Button>
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
      <Title level={2}>{t("title")}</Title>
      <Table
        dataSource={items}
        columns={columns}
        loading={loading}
        rowKey={(r) => `${r.entityType}-${r.id}`}
        locale={{ emptyText: t("empty") }}
      />
    </>
  );
}
