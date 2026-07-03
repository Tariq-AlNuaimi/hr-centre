"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { BadgeProps } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: Record<string, unknown> | null;
  user: { id: string; name: string | null; email: string } | null;
  timestamp: string;
}

const ACTION_VARIANTS: Record<string, BadgeProps["variant"]> = {
  CREATE: "success",
  UPDATE: "brand",
  DELETE: "danger",
  RESTORE: "warning",
};

export default function AuditLogClient() {
  const t = useTranslations("auditLog");
  const { error: showError } = useNotify();

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

      // The audit-log GET wraps a paginated payload in the envelope, so the
      // unwrapped `data` is itself `{ data: AuditEntry[]; total: number }`.
      const res = await apiClient.get<{ data: AuditEntry[]; total: number }>(
        `/api/audit-log?${params}`
      );
      setData(res.data);
      setTotal(res.total);
    } catch {
      showError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, entityType, action, showError, t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Memoized so <DataTable> receives a stable columns reference across renders
  // (rebuilt only when the translators change). Mirrors the users page pattern.
  const columns: ColumnsType<AuditEntry> = useMemo(
    () => [
      {
        title: t("timestamp"),
        dataIndex: "timestamp",
        width: 180,
        render: (v: string) => formatDateTime(v),
      },
      {
        title: t("action"),
        dataIndex: "action",
        width: 100,
        render: (v: string) => (
          <Badge variant={ACTION_VARIANTS[v] ?? "default"}>{v}</Badge>
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
          <span className="font-mono text-xs">{v}</span>
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
    ],
    [t]
  );

  return (
    <>
      <PageHeader title={t("title")} />

      <div className="mb-4 flex flex-wrap gap-2">
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
      </div>

      <DataTable<AuditEntry>
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, ps) => {
          setPage(p);
          setPageSize(ps);
        }}
        scroll={{ x: 900 }}
        size="small"
      />
    </>
  );
}
