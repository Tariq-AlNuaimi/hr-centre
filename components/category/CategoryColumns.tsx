"use client";

import { getRowActionsColumn } from "@/components/shared/RowActions";

export interface CategoryRecord {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
}

// The returned column objects are DataTable-shaped (title/dataIndex/render/
// sorter/filters); the rebuilt DataTable consumes that shape at runtime and
// converts it to tanstack ColumnDefs internally. The shape is left to inference
// so this file carries no table-library import.
export function getCategoryColumns({
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
      title: t("description"),
      dataIndex: "description",
      key: "description",
      sorter: true,
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    getRowActionsColumn<CategoryRecord>({ onEdit, onDelete, t }),
  ];
}
