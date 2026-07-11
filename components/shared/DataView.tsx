"use client";

import type { ColumnType, ColumnsType, FilterValue, Key } from "@/components/shared/table-types";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DataTable, type SortChange } from "./DataTable";

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
    selectedRowKeys: Key[];
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
 * DataView (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, IDENTICAL prop
 * API). The branded list view: a DataTable plus the chrome a "finished" admin
 * list needs — a toolbar (filters + actions), optional row selection with a bulk
 * action bar that appears on selection, and a column-visibility control (now a
 * Radix popover). Builds on the rebuilt DataTable primitive (server
 * pagination/search/sort/selection) rather than reimplementing it.
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

  const allKeys = useMemo(() => columns.map((c, i) => columnKey(c as ColumnType<T>, i)), [columns]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(allKeys);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  // Keep only configured-visible columns; always keep at least one.
  const visibleColumns = useMemo(() => {
    const keep = new Set(visibleKeys.length ? visibleKeys : allKeys);
    return columns.filter((c, i) => keep.has(columnKey(c as ColumnType<T>, i)));
  }, [columns, visibleKeys, allKeys]);

  const selectedRows = useMemo(
    () => dataSource.filter((row) => selectedRowKeys.includes(row[rowKey] as Key)),
    [dataSource, selectedRowKeys, rowKey],
  );

  const clear = () => setSelectedRowKeys([]);
  const selectionActive = bulkActions != null && selectedRowKeys.length > 0;

  const toggleColumn = (key: string, checked: boolean) => {
    setVisibleKeys((prev) => {
      const next = checked ? [...prev, key] : prev.filter((k) => k !== key);
      // Never let the user hide every column.
      return next.length > 0 ? next : prev;
    });
  };

  const columnToggle = !disableColumnToggle && (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {t("columns")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <ul className="flex flex-col gap-0.5">
          {columns.map((c, i) => {
            const key = columnKey(c as ColumnType<T>, i);
            const title = (c as ColumnType<T>).title as React.ReactNode;
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={visibleKeys.includes(key)}
                    onChange={(e) => toggleColumn(key, e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {title || <span className="text-muted-foreground">—</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex flex-col gap-4">
      {selectionActive ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-4 py-2">
          <span className="text-sm font-medium text-foreground">
            {t("selected", { count: selectedRowKeys.length })}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions?.({ selectedRowKeys, selectedRows, clear })}
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("clearSelection")}
            </Button>
          </div>
        </div>
      ) : (
        (toolbarActions || toolbarFilters || columnToggle) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">{toolbarFilters}</div>
            <div className="flex flex-wrap items-center gap-2">
              {columnToggle}
              {toolbarActions}
            </div>
          </div>
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
                onChange: (keys) => setSelectedRowKeys(keys),
                preserveSelectedRowKeys: true,
              }
            : undefined
        }
        {...pagination}
      />
    </div>
  );
}
