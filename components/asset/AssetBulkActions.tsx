"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { useNotify } from "@/hooks/use-notify";

/**
 * Bulk-action bar for the asset list (T-app-floor). Appears only when rows are selected —
 * an always-visible bar with a disabled button would be a dead control (UI DoD). Confirms
 * before the destructive call (ConfirmAction, the shared Popconfirm replacement), then POSTs
 * the selected ids to `/api/asset/bulk-delete`, which deletes them per-row inside one
 * transaction so the audit + soft-delete extensions still run (ADR-010).
 *
 * Feedback is honest: a failure toasts the server's error message and the selection is KEPT
 * so the operator can retry; only a success clears it and refetches the list.
 */
export function AssetBulkActions({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const t = useTranslations("assets");
  const { success, error: showError } = useNotify();
  const [pending, setPending] = useState(false);

  if (selectedIds.length === 0) return null;

  const doBulkDelete = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/asset/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const j: { data?: { deleted?: number }; error?: string } = await res.json();
      if (!res.ok) {
        showError(j.error ?? t("bulkDeleteFailed"));
        return;
      }
      success(t("bulkDeleted", { count: j.data?.deleted ?? 0 }));
      onDone();
    } catch {
      showError(t("bulkDeleteFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-3">
      <span className="text-sm text-foreground">
        {t("bulkSelected", { count: selectedIds.length })}
      </span>
      <ConfirmAction
        title={t("bulkDeleteConfirm", { count: selectedIds.length })}
        okType="danger"
        onConfirm={doBulkDelete}
      >
        <Button type="button" variant="destructive" size="sm" disabled={pending}>
          {pending ? t("bulkDeleting") : t("bulkDeleteAction")}
        </Button>
      </ConfirmAction>
    </div>
  );
}
