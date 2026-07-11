"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { formatDate } from "@/lib/format";

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

// Role -> Badge tone. Preserves the prior AntD Tag intent (admin=red/danger,
// editor=accent, viewer=neutral) on the shared Badge primitive.
const roleTone: Record<string, BadgeProps["variant"]> = {
  ADMIN: "danger",
  EDITOR: "brand",
  VIEWER: "default",
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

// The returned column objects are AntD-shaped (title/dataIndex/render/sorter/
// filters) because the rebuilt DataTable consumes that shape at runtime and
// converts it to tanstack ColumnDefs internally (see components/shared/
// DataTable.tsx). The AntD *value/type* imports are gone; the shape is left to
// inference so this file carries no antd dependency.
export function getUserColumns({
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
      title: t("name"),
      dataIndex: "name",
      key: "name",
      sorter: true,
    },
    {
      title: t("email"),
      dataIndex: "email",
      key: "email",
      sorter: true,
    },
    {
      title: t("role"),
      dataIndex: "role",
      key: "role",
      render: (role: string) => <Badge variant={roleTone[role] ?? "default"}>{role}</Badge>,
      filters: [
        { text: t("roleAdmin"), value: "ADMIN" },
        { text: t("roleEditor"), value: "EDITOR" },
        { text: t("roleViewer"), value: "VIEWER" },
      ],
      filterMultiple: false,
    },
    {
      title: t("lastLogin"),
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      render: (val: string | null) => (val ? formatDate(val) : "-"),
      sorter: true,
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => formatDate(val),
      sorter: true,
    },
    {
      title: "",
      key: "actions",
      width: 100,
      render: (_: unknown, record: UserRecord) => (
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
              className="text-destructive-emphasis hover:text-destructive-emphasis"
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
