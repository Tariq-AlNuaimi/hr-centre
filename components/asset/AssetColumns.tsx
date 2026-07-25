"use client";

import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { getRowActionsColumn } from "@/components/shared/RowActions";
import { assetStatusLabel } from "@/components/asset/asset-labels";

export interface AssetRecord {
  id: string;
  assetTag: string;
  name: string;
  serial?: string | null;
  location?: string | null;
  purchasedAt?: string | null;
  warrantyExpiresAt?: string | null;
  warrantyTerms?: string | null;
  status: "IN_STOCK" | "ASSIGNED" | "REPAIR" | "RETIRED";
  modelId?: string | null;
  model?: {
    id: string;
    name: string;
    category?: { id: string; name: string } | null;
    manufacturer?: { id: string; name: string } | null;
  } | null;
  assigneeId?: string | null;
  assignee?: { id: string; name: string | null } | null;
  createdAt: string;
}

// Status tones only — the LAPTOP/MONITOR/PHONE/OTHER entries went with the retired
// `Asset.category` enum (item 7); catalog categories are open-ended so they render untoned.
const tone: Record<string, BadgeProps["variant"]> = {
  IN_STOCK: "brand",
  ASSIGNED: "success",
  REPAIR: "warning",
  RETIRED: "danger",
};

// The returned column objects are DataTable-shaped (title/dataIndex/render/
// sorter/filters); the rebuilt DataTable consumes that shape at runtime and
// converts it to tanstack ColumnDefs internally. The shape is left to inference
// so this file carries no table-library import.
export function getAssetColumns({
  onEdit,
  onDelete,
  t,
  categoryFilters = [],
}: {
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
  /** Category-entity filter options (id + name), fetched by the list page (item 7). */
  categoryFilters?: Array<{ text: string; value: string }>;
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
        return <Badge variant={tone[val] ?? "default"}>{assetStatusLabel(val)}</Badge>;
      },
      filters: [
        { text: assetStatusLabel("IN_STOCK"), value: "IN_STOCK" },
        { text: assetStatusLabel("ASSIGNED"), value: "ASSIGNED" },
        { text: assetStatusLabel("REPAIR"), value: "REPAIR" },
        { text: assetStatusLabel("RETIRED"), value: "RETIRED" },
      ],
      filterMultiple: false,
    },
    {
      // Category is DERIVED from the catalog hierarchy (model → AssetModel.category → Category),
      // not from the retired `Asset.category` enum (item 7). Not sortable: `parseListQuery`'s
      // SORTABLE_COLUMNS allowlist covers scalar columns only, and sorting on a nested relation
      // would need a different orderBy shape. Filterable via the dynamic options passed in.
      title: t("category"),
      key: "category",
      render: (_: unknown, record: AssetRecord) => {
        const name = record.model?.category?.name;
        if (!name) return "-";
        return <Badge variant="default">{name}</Badge>;
      },
      filters: categoryFilters,
      filterMultiple: false,
    },
    {
      title: t("model"),
      key: "model",
      render: (_: unknown, record: AssetRecord) =>
        record.model
          ? record.model.manufacturer
            ? `${record.model.manufacturer.name} ${record.model.name}`
            : record.model.name
          : "-",
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
    getRowActionsColumn<AssetRecord>({ onEdit, onDelete, t }),
  ];
}
