"use client";

import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { getRowActionsColumn } from "@/components/shared/RowActions";
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

// The returned column objects are DataTable-shaped (title/dataIndex/render/sorter/
// filters); the rebuilt DataTable consumes that shape at runtime and converts it to
// tanstack ColumnDefs internally (see components/shared/DataTable.tsx). The shape is
// left to inference so this file carries no table-library dependency.
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
    getRowActionsColumn<UserRecord>({ onEdit, onDelete, t }),
  ];
}
