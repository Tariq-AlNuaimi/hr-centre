"use client";

import { getRowActionsColumn } from "@/components/shared/RowActions";

export interface AssetModelRecord {
  id: string;
  name: string;
  categoryId: string;
  category: { id: string; name: string | null };
  manufacturerId: string;
  manufacturer: { id: string; name: string | null };
  createdAt: string;
}

// DataTable-shaped column descriptors (see DataTable); shape left to inference.
export function getAssetModelColumns({
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
      title: t("category"),
      key: "category",
      render: (_: unknown, record: AssetModelRecord) => record.category?.name ?? "-",
    },
    {
      title: t("manufacturer"),
      key: "manufacturer",
      render: (_: unknown, record: AssetModelRecord) => record.manufacturer?.name ?? "-",
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    getRowActionsColumn<AssetModelRecord>({ onEdit, onDelete, t }),
  ];
}
