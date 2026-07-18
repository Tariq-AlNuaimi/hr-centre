"use client";

import { getRowActionsColumn } from "@/components/shared/RowActions";

export interface CustomFieldDefRecord {
  id: string;
  label: string;
  key: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN";
  required: boolean;
  createdAt: string;
}

// DataTable-shaped column descriptors (see DataTable); shape left to inference.
export function getCustomFieldDefColumns({
  onEdit,
  onDelete,
  t,
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}) {
  return [
    { title: t("label"), dataIndex: "label", key: "label", sorter: true },
    { title: t("key"), dataIndex: "key", key: "key", sorter: true },
    { title: t("type"), dataIndex: "type", key: "type", sorter: true },
    {
      title: t("required"),
      key: "required",
      render: (_: unknown, record: CustomFieldDefRecord) => (record.required ? t("yes") : t("no")),
    },
    {
      title: t("createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) => new Date(val).toLocaleDateString(),
      sorter: true,
    },
    getRowActionsColumn<CustomFieldDefRecord>({ onEdit, onDelete, t }),
  ];
}
