"use client";

import { getRowActionsColumn } from "@/components/shared/RowActions";

export interface ManufacturerRecord {
  id: string;
  name: string;
  website?: string | null;
  createdAt: string;
}

// DataTable-shaped column descriptors (see DataTable); shape left to inference.
export function getManufacturerColumns({
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
      title: t("website"),
      dataIndex: "website",
      key: "website",
      sorter: true,
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    getRowActionsColumn<ManufacturerRecord>({ onEdit, onDelete, t }),
  ];
}
