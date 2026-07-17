"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/shared/ConfirmAction";

export interface AssetRecord {
  id: string;
  assetTag: string;
  name: string;
  serial?: string | null;
  purchasedAt?: string | null;
  status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
  category: "LAPTOP" | "MONITOR" | "PHONE" | "OTHER";
  assigneeId?: string | null;
  assignee?: { id: string; name: string | null } | null;
  createdAt: string;
}

const tone: Record<string, BadgeProps["variant"]> = {
  IN_STOCK: "brand",
  ASSIGNED: "success",
  REPAIR: "warning",
  RETIRED: "danger",
  LAPTOP: "default",
  MONITOR: "brand",
  PHONE: "success",
  OTHER: "warning",
};

function EditIcon() {
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

function DeleteIcon() {
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

// The returned column objects are DataTable-shaped (title/dataIndex/render/
// sorter/filters); the rebuilt DataTable consumes that shape at runtime and
// converts it to tanstack ColumnDefs internally. The shape is left to inference
// so this file carries no table-library import.
export function getAssetColumns({
  onEdit,
  onDelete,
  t,
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) {
  return [
    {
      title: t("assetTag"),
      dataIndex: "assetTag",
      key: "assetTag",
      sorter: true,
    },
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      sorter: true,
    },
    {
      title: t("serial"),
      dataIndex: "serial",
      key: "serial",
      sorter: true,
    },
    {
      title: t("purchasedAt"),
      dataIndex: "purchasedAt",
      key: "purchasedAt",
      sorter: true,
      render: (val: string | null) => (val ? new Date(val).toLocaleDateString() : "-"),
    },
    {
      title: t("status"),
      dataIndex: "status",
      key: "status",
      sorter: true,
      render: (val: string | null) => {
        if (!val) return "-";
        return <Badge variant={tone[val] ?? "default"}>{val}</Badge>;
      },
      filters: [
        { text: "IN_STOCK", value: "IN_STOCK" },
        { text: "ASSIGNED", value: "ASSIGNED" },
        { text: "REPAIR", value: "REPAIR" },
        { text: "RETIRED", value: "RETIRED" },
      ],
      filterMultiple: false,
    },
    {
      title: t("category"),
      dataIndex: "category",
      key: "category",
      sorter: true,
      render: (val: string | null) => {
        if (!val) return "-";
        return <Badge variant={tone[val] ?? "default"}>{val}</Badge>;
      },
      filters: [
        { text: "LAPTOP", value: "LAPTOP" },
        { text: "MONITOR", value: "MONITOR" },
        { text: "PHONE", value: "PHONE" },
        { text: "OTHER", value: "OTHER" },
      ],
      filterMultiple: false,
    },
    {
      title: t("assignee"),
      key: "assignee",
      render: (_: unknown, record: AssetRecord) => record.assignee?.name ?? "-",
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    {
      title: "",
      key: "actions",
      width: 100,
      render: (_: unknown, record: AssetRecord) => (
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
    },
  ];
}
