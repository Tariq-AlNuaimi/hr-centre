"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { EmptyState } from "@/components/shared/EmptyState";
import { Field } from "@/components/shared/FormControls";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * Admin › Email log — every module's emails in one list: what was sent, queued
 * or failed, to whom and why it failed. Bodies are never stored, so none is
 * shown. A failed JML email can be resent (a new queued row linked to it).
 */

type Row = {
  id: string;
  module: string;
  type: string;
  recipient: string;
  cc: string | null;
  subject: string;
  status: "QUEUED" | "SENT" | "FAILED" | "CANCELLED";
  scheduledFor: string;
  sentAt: string | null;
  failureReason: string | null;
  resendOfId: string | null;
  createdAt: string;
  sentBy: { name: string | null; email: string } | null;
  resent: boolean;
  canResend: boolean;
};
type Page = { data: Row[]; total: number; page: number; totalPages: number; modules: string[] };

const STATUSES = ["QUEUED", "SENT", "FAILED", "CANCELLED"] as const;
const BADGE: Record<Row["status"], "default" | "success" | "warning" | "danger"> = {
  QUEUED: "warning",
  SENT: "success",
  FAILED: "danger",
  CANCELLED: "default",
};

export function EmailLogAdmin() {
  const t = useTranslations("emailLog");
  const { success, error: notifyError } = useNotify();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState({ module: "", status: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(
    Object.entries({ ...filter, page: String(page), pageSize: "50" }).filter(([, v]) => v),
  ).toString();
  const q = useQuery({
    queryKey: ["email-log", qs],
    queryFn: () => apiClient.get<Page>(`/api/email-log?${qs}`),
    retry: false,
  });
  const set = (k: keyof typeof filter, v: string) => {
    setFilter((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  async function resend(r: Row) {
    try {
      await apiClient.post(`/api/email-log/${r.id}/resend`);
      success(t("resent"));
      await queryClient.invalidateQueries({ queryKey: ["email-log"] });
    } catch (e) {
      notifyError(e instanceof ApiError ? e.message : t("resendFailed"));
    }
  }

  const modules = q.data?.modules ?? [];
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SectionCard title={t("filters")}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="el-module" label={t("module")}>
            <NativeSelect
              id="el-module"
              value={filter.module}
              onChange={(e) => set("module", e.target.value)}
              className="w-full"
            >
              <option value="">{t("allModules")}</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {t.has(`modules.${m}`) ? t(`modules.${m}`) : m}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="el-status" label={t("status")}>
            <NativeSelect
              id="el-status"
              value={filter.status}
              onChange={(e) => set("status", e.target.value)}
              className="w-full"
            >
              <option value="">{t("allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="el-from" label={t("from")}>
            <Input
              id="el-from"
              type="date"
              value={filter.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </Field>
          <Field id="el-to" label={t("to")}>
            <Input
              id="el-to"
              type="date"
              value={filter.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>
      <SectionCard title={t("listTitle")} subtitle={t("listNote")} noBodyPadding>
        {q.isLoading ? (
          <TableSkeleton rows={8} />
        ) : q.isError || !q.data ? (
          <p role="alert" className="p-4 text-sm text-destructive-emphasis">
            {q.error instanceof ApiError ? q.error.message : t("loadFailed")}
          </p>
        ) : q.data.data.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <EmailLogTable rows={q.data.data} onResend={resend} />
        )}
        {q.data && q.data.totalPages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t border-border p-3 text-sm">
            <span className="text-muted-foreground">
              {t("pageOf", { page: q.data.page, pages: q.data.totalPages, total: q.data.total })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t("previous")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= q.data.totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t("next")}
            </Button>
          </div>
        ) : null}
      </SectionCard>
    </>
  );
}

function EmailLogTable({ rows, onResend }: { rows: Row[]; onResend: (r: Row) => void }) {
  const t = useTranslations("emailLog");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {["when", "module", "type", "recipient", "subject", "status"].map((k) => (
              <th key={k} className="px-3 py-2 text-start font-medium">
                {t(`col.${k}`)}
              </th>
            ))}
            <th className="px-3 py-2">
              <span className="sr-only">{t("col.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border align-top last:border-b-0">
              <td className="whitespace-nowrap px-3 py-2">
                {formatDateTime(r.sentAt ?? r.scheduledFor)}
              </td>
              <td className="px-3 py-2">
                {t.has(`modules.${r.module}`) ? t(`modules.${r.module}`) : r.module}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.type}</td>
              <td className="px-3 py-2">
                {r.recipient}
                {r.cc ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("cc", { cc: r.cc })}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {r.subject}
                {r.resendOfId ? (
                  <span className="block text-xs text-muted-foreground">{t("isResend")}</span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <Badge variant={BADGE[r.status]}>{t(`statuses.${r.status}`)}</Badge>
                {r.failureReason ? (
                  <span className="mt-1 block max-w-xs text-xs text-destructive-emphasis">
                    {r.failureReason}
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-end">
                {r.canResend ? (
                  <Button size="sm" variant="outline" onClick={() => onResend(r)}>
                    {t("resend")}
                  </Button>
                ) : r.resent ? (
                  <span className="text-xs text-muted-foreground">{t("alreadyResent")}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
