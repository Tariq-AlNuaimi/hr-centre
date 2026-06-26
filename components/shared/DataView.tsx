"use client";

import { Button, Checkbox, Popover, Space, Typography, theme } from "antd";
import type { ColumnType, ColumnsType } from "antd/es/table";
import type { FilterValue } from "antd/es/table/interface";
import { ControlOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { DataTable, type SortChange } from "./DataTable";

const { Text } = Typography;

/** Stable string key for a column (key, else dataIndex, else position). */
function columnKey<T>(col: ColumnType<T>, index: number): string {
  if (col.key != null) return String(col.key);
  const di = (col as { dataIndex?: unknown }).dataIndex;
  if (typeof di === "string" || typeof di === "number") return String(di);
  return `col-${index}`;
}

export interface DataViewProps<T> {
  columns: ColumnsType<T>;
  dataSource: T[];
  /** Row key field (default "id"). Used for selection + row lookup. */
  rowKey?: keyof T & string;
  loading?: boolean;
  emptyText?: React.ReactNode;

  // --- Toolbar -------------------------------------------------------------
  /** Inline-end toolbar actions (the screen's primary action lives here). */
  toolbarActions?: React.ReactNode;
  /** Extra inline-start toolbar nodes (filters), shown beside column controls. */
  toolbarFilters?: React.ReactNode;
  searchable?: boolean;
  onSearch?: (value: string) => void;

  // --- Selection + bulk actions -------------------------------------------
  /** Render the bulk-action controls; presence enables row selection. */
  bulkActions?: (ctx: {
    selectedRowKeys: React.Key[];
    selectedRows: T[];
    clear: () => void;
  }) => React.ReactNode;

  /** Hide the column-visibility control (shown by default). */
  disableColumnToggle?: boolean;

  // --- Server pagination passthrough (see DataTable) -----------------------
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onSortChange?: (sort: SortChange) => void;
  onFilterChange?: (filters: Record<string, FilterValue | null>) => void;
}

/**
 * The branded list view: a DataTable plus the chrome a "finished" admin list
 * needs — a toolbar (filters + actions), optional row selection with a bulk
 * action bar that appears on selection, and a column-visibility control. Builds
 * on the existing DataTable primitive (server pagination/search/sort) rather
 * than reimplementing it.
 */
export function DataView<T extends object>({
  columns,
  dataSource,
  rowKey = "id" as keyof T & string,
  loading,
  emptyText,
  toolbarActions,
  toolbarFilters,
  searchable,
  onSearch,
  bulkActions,
  disableColumnToggle,
  ...pagination
}: DataViewProps<T>) {
  const t = useTranslations("data");
  const { token } = theme.useToken();

  const allKeys = useMemo(
    () => columns.map((c, i) => columnKey(c as ColumnType<T>, i)),
    [columns],
  );
  const [visibleKeys, setVisibleKeys] = useState<string[]>(allKeys);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Keep only configured-visible columns; always keep at least one.
  const visibleColumns = useMemo(() => {
    const keep = new Set(visibleKeys.length ? visibleKeys : allKeys);
    return columns.filter((c, i) => keep.has(columnKey(c as ColumnType<T>, i)));
  }, [columns, visibleKeys, allKeys]);

  const selectedRows = useMemo(
    () =>
      dataSource.filter((row) =>
        selectedRowKeys.includes(row[rowKey] as React.Key),
      ),
    [dataSource, selectedRowKeys, rowKey],
  );

  const clear = () => setSelectedRowKeys([]);
  const selectionActive = bulkActions != null && selectedRowKeys.length > 0;

  const columnToggle = !disableColumnToggle && (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <Checkbox.Group
          value={visibleKeys}
          onChange={(vals) => {
            // Never let the user hide every column.
            if (vals.length > 0) setVisibleKeys(vals as string[]);
          }}
        >
          <Space orientation="vertical">
            {columns.map((c, i) => {
              const key = columnKey(c as ColumnType<T>, i);
              return (
                <Checkbox key={key} value={key}>
                  {(c as ColumnType<T>).title as React.ReactNode}
                </Checkbox>
              );
            })}
          </Space>
        </Checkbox.Group>
      }
    >
      <Button icon={<ControlOutlined />}>{t("columns")}</Button>
    </Popover>
  );

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      {selectionActive ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: token.marginSM,
            flexWrap: "wrap",
            padding: `${token.paddingXS}px ${token.paddingSM}px`,
            background: token.colorPrimaryBg,
            border: `1px solid ${token.colorPrimaryBorder}`,
            borderRadius: token.borderRadius,
          }}
        >
          <Text strong>{t("selected", { count: selectedRowKeys.length })}</Text>
          <Space wrap>
            {bulkActions?.({ selectedRowKeys, selectedRows, clear })}
            <Button type="text" size="small" onClick={clear}>
              {t("clearSelection")}
            </Button>
          </Space>
        </div>
      ) : (
        (toolbarActions || toolbarFilters || columnToggle) && (
          <Space
            style={{ width: "100%", justifyContent: "space-between" }}
            wrap
          >
            <Space wrap>{toolbarFilters}</Space>
            <Space wrap>
              {columnToggle}
              {toolbarActions}
            </Space>
          </Space>
        )
      )}

      <DataTable<T>
        columns={visibleColumns}
        dataSource={dataSource}
        rowKey={rowKey}
        loading={loading}
        emptyText={emptyText}
        searchable={searchable}
        onSearch={onSearch}
        rowSelection={
          bulkActions
            ? {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
                preserveSelectedRowKeys: true,
              }
            : undefined
        }
        {...pagination}
      />
    </Space>
  );
}
