"use client";

import { Table, Input, Space } from "antd";
import type { TableProps, TablePaginationConfig } from "antd";
import type { FilterValue } from "antd/es/table/interface";
import { SearchOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

// Debounce window for the search box: long enough to coalesce a burst of
// keystrokes into one API query, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 300;

export interface SortChange {
  field?: string;
  order?: "ascend" | "descend";
}

interface DataTableProps<T> extends Omit<TableProps<T>, "pagination"> {
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
  onSortChange?: (sort: SortChange) => void;
  onFilterChange?: (filters: Record<string, FilterValue | null>) => void;
  searchable?: boolean;
  onSearch?: (value: string) => void;
  /** Custom node rendered when there are no rows (e.g. <EmptyState />). Falls
   * back to the translated "No data found" text. */
  emptyText?: React.ReactNode;
}

export function DataTable<T extends object>({
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
  onSortChange,
  onFilterChange,
  searchable = false,
  onSearch,
  emptyText,
  ...tableProps
}: DataTableProps<T>) {
  const t = useTranslations("common");
  const [searchValue, setSearchValue] = useState("");

  // Debounce the onSearch callback (CP-PO2) so typing fires ONE query, not one
  // per keystroke. The input stays controlled/instant; only the parent
  // notification is delayed. A ref holds the latest onSearch so the debounced
  // closure never goes stale, and the pending timer is cleared on unmount.
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const handleSearch = useCallback((value: string) => {
    setSearchValue(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onSearchRef.current?.(value), SEARCH_DEBOUNCE_MS);
  }, []);

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`,
  };

  // Ant Table fires onChange for pagination, sorting and filtering. We lift
  // each concern to the parent so it can re-query the API. (pagination.onChange
  // alone only covers page changes; sorter/filters need this handler.)
  const handleChange: TableProps<T>["onChange"] = (
    paginationArg,
    filters,
    sorter
  ) => {
    if (paginationArg.current && paginationArg.pageSize) {
      onPageChange?.(paginationArg.current, paginationArg.pageSize);
    }
    if (onSortChange) {
      const single = Array.isArray(sorter) ? sorter[0] : sorter;
      onSortChange({
        field:
          typeof single?.field === "string" ? single.field : undefined,
        order: single?.order ?? undefined,
      });
    }
    onFilterChange?.(filters);
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      {searchable && (
        <Input
          prefix={<SearchOutlined />}
          placeholder={t("search")}
          aria-label={t("search")}
          value={searchValue}
          onChange={(e) => handleSearch(e.target.value)}
          allowClear
          style={{ maxWidth: 400 }}
        />
      )}
      <Table<T>
        pagination={pagination}
        onChange={handleChange}
        rowKey="id"
        locale={{ emptyText: emptyText ?? t("noData") }}
        {...tableProps}
      />
    </Space>
  );
}
