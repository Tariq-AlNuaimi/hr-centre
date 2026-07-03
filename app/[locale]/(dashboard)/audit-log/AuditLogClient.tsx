"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { ColumnsType } from "@/components/shared/table-types";
import type { BadgeProps } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    // Load-on-dependency-change data fetch: fetchLogs() flips loading state
    // synchronously (intended spinner UX), which react-hooks/set-state-in-effect
    // flags. This is the documented fetch-in-effect pattern, not a cascading
    // render bug — suppressed narrowly rather than restructured.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect
          label={t("filterEntity")}
          value={entityType}
          onChange={setEntityType}
          onClear={() => setEntityType(undefined)}
          clearLabel={t("clearFilter")}
          options={[{ value: "User", label: "User" }]}
        />
        <FilterSelect
          label={t("filterAction")}
          value={action}
          onChange={setAction}
          onClear={() => setAction(undefined)}
          clearLabel={t("clearFilter")}
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

/**
 * Filter dropdown for the audit log: a labelled Select with an inline clear
 * button (the AntD `allowClear` affordance). Controlled by the empty-string
 * convention — value "" means "no selection", so the placeholder shows and no
 * SelectItem carries an empty value. The trigger is `aria-label`led for axe.
 */
function FilterSelect({
  label,
  value,
  onChange,
  onClear,
  clearLabel,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  onClear: () => void;
  clearLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-40">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={clearLabel}
          onClick={onClear}
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Button>
      )}
    </div>
  );
}
