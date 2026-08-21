"use client";

import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";

/**
 * Shared DataTable row-actions cell (edit + confirmed-delete) and its icons.
 *
 * Every entity's `*Columns.tsx` previously re-declared the same `EditIcon`/`DeleteIcon`
 * SVGs plus an identical ghost-edit + `ConfirmAction`-delete cell — the jscpd Maintainable
 * gate flags that once ≥3 entities exist. This is the one shared home (build-vs-buy ledger,
 * 2026-07-18), an internal composition of the shipped `Button` + `ConfirmAction` primitives.
 */

/** @public */
export function EditIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

/** @public */
export function DeleteIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/**
 * A DataTable-shaped actions column: a ghost edit button + a confirmed destructive
 * delete. `t` supplies `editAction` / `deleteAction` / `deleteConfirm` labels.
 */
export function getRowActionsColumn<T extends { id: string }>({
  onEdit,
  onDelete,
  t,
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) {
  return {
    title: "",
    key: "actions",
    width: 100,
    render: (_: unknown, record: T) => (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("editAction")}
          onClick={() => onEdit(record.id)}
        >
          <EditIcon />
        </Button>
        <ConfirmAction title={t("deleteConfirm")} onConfirm={() => onDelete(record.id)}>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label={t("deleteAction")}
          >
            <DeleteIcon />
          </Button>
        </ConfirmAction>
      </div>
    ),
  };
}
