"use client";

import { useEffect, useState, useCallback } from "react";
import { Typography, Table, Select, Space, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslations } from "next-intl";

const { Title } = Typography;

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown> | null;
  user: { id: string; name: string | null; email: string } | null;
  timestamp: string;
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: "green",
  UPDATE: "blue",
  DELETE: "red",
  RESTORE: "orange",
};

export default function AuditLogPage() {
  const t = useTranslations("auditLog");

  const [data, setData] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [entityType, setEntityType] = useState<string>();
  const [action, setAction] = useState<string>();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (entityType) params.set("entityType", entityType);
      if (action) params.set("action", action);

      const res = await fetch(`/api/audit-log?${params}`);
      const json = await res.json();
      if (res.ok) {
        setData(json.data.data);
        setTotal(json.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, entityType, action]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const columns: ColumnsType<AuditEntry> = [
    {
      title: t("timestamp"),
      dataIndex: "timestamp",
      width: 180,
      render: (v: string) =>
        new Date(v).toLocaleString(undefined, {
          dateStyle: "short",
          timeStyle: "medium",
        }),
    },
    {
      title: t("action"),
      dataIndex: "action",
      width: 100,
      render: (v: string) => (
        <Tag color={ACTION_COLORS[v] ?? "default"}>{v}</Tag>
      ),
    },
    {
      title: t("entity"),
      dataIndex: "entityType",
      width: 120,
    },
    {
      title: t("entityId"),
      dataIndex: "entityId",
      width: 200,
      render: (v: string) => (
        <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span>
      ),
    },
    {
      title: t("user"),
      dataIndex: "user",
      width: 180,
      render: (user: AuditEntry["user"]) =>
        user ? user.name ?? user.email : "-",
    },
    {
      title: t("changes"),
      dataIndex: "changes",
      ellipsis: true,
      render: (changes: Record<string, unknown> | null) =>
        changes ? Object.keys(changes).join(", ") : "-",
    },
  ];

  return (
    <>
      <Title level={2}>{t("title")}</Title>

      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder={t("filterEntity")}
          allowClear
          style={{ width: 150 }}
          onChange={setEntityType}
          options={[{ value: "User", label: "User" }]}
        />
        <Select
          placeholder={t("filterAction")}
          allowClear
          style={{ width: 150 }}
          onChange={setAction}
          options={["CREATE", "UPDATE", "DELETE", "RESTORE"].map((a) => ({
            value: a,
            label: a,
          }))}
        />
      </Space>

      <Table<AuditEntry>
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        scroll={{ x: 900 }}
        size="small"
      />
    </>
  );
}
