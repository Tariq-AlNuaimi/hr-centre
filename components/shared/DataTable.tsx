"use client";

import type {
  TableProps,
  ColumnType,
  ColumnsType,
  FilterValue,
  Key,
} from "@/components/shared/table-types";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Debounce window for the search box: long enough to coalesce a burst of
// keystrokes into one API query, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface SortChange {
  field?: string;
  order?: "ascend" | "descend";
}

/**
 * DataTable (ADR-029, Workstream C2 — shadcn Table + @tanstack/react-table
 * rebuild, IDENTICAL prop API). Server-driven list table: it renders AntD-shaped
 * columns (title/dataIndex/render/sorter/filters/width/align/ellipsis) through
 * tanstack's column + core row model on shadcn `<table>` markup, and lifts
 * sorting, pagination, filtering and row selection to the parent so it can
 * re-query the API — matching the AntD Table this replaces. AntD stays a
 * type-only import during the coexistence slice, so every existing screen keeps
 * compiling unchanged.
 */
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

/** Stable string key for a column (key, else dataIndex, else position). */
function columnKey<T>(col: ColumnType<T>, index: number): string {
  if (col.key != null) return String(col.key);
  const di = (col as { dataIndex?: unknown }).dataIndex;
  if (typeof di === "string" || typeof di === "number") return String(di);
  return `col-${index}`;
}

/** Read a (possibly nested) dataIndex off a row. */
function readCell(row: unknown, dataIndex: unknown): unknown {
  if (dataIndex == null) return undefined;
  const rec = row as Record<string, unknown>;
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce<unknown>(
      (acc, k) => (acc as Record<string, unknown> | undefined)?.[String(k)],
      rec,
    );
  }
  return rec[String(dataIndex)];
}

type ColumnMeta<T> = {
  antd: ColumnType<T>;
  align?: "left" | "center" | "right";
  width?: string | number;
  ellipsis?: boolean;
};

function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
  return (
    <span aria-hidden className="inline-flex flex-col leading-none">
      <svg
        viewBox="0 0 8 5"
        className={cn(
          "h-1.5 w-2",
          dir === "asc" ? "text-primary" : "text-muted-foreground/40",
        )}
        fill="currentColor"
      >
        <path d="M4 0l4 5H0z" />
      </svg>
      <svg
        viewBox="0 0 8 5"
        className={cn(
          "mt-0.5 h-1.5 w-2",
          dir === "desc" ? "text-primary" : "text-muted-foreground/40",
        )}
        fill="currentColor"
      >
        <path d="M4 5L0 0h8z" />
      </svg>
    </span>
  );
}

/** Native checkbox styled on-token (brand accent, focus ring, indeterminate). */
function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer rounded border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
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
  columns: antdColumns,
  dataSource,
  rowKey = "id",
  loading,
  rowSelection,
  scroll,
  size,
}: DataTableProps<T>) {
  const t = useTranslations("common");
  const [searchValue, setSearchValue] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<Record<string, FilterValue | null>>(
    {},
  );

  const rows = useMemo(() => (dataSource ?? []) as T[], [dataSource]);
  const columns = useMemo(
    () => (antdColumns ?? []) as ColumnsType<T>,
    [antdColumns],
  );

  // Stable per-row key (string), matching the AntD rowKey contract.
  const resolveRowKey = useCallback(
    (record: T, index: number): string => {
      if (typeof rowKey === "function") return String(rowKey(record));
      if (typeof rowKey === "string")
        return String((record as Record<string, unknown>)[rowKey] ?? index);
      return String((record as Record<string, unknown>).id ?? index);
    },
    [rowKey],
  );

  // --- Debounced search (CP-PO2): typing fires ONE query, not one per key. ---
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const handleSearch = useCallback((value: string) => {
    setSearchValue(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => onSearchRef.current?.(value),
      SEARCH_DEBOUNCE_MS,
    );
  }, []);

  // --- Sorting: bridge tanstack SortingState -> AntD-shaped onSortChange. -----
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    setSorting(next);
    const first = next[0];
    onSortChange?.({
      field: first?.id,
      order: first ? (first.desc ? "descend" : "ascend") : undefined,
    });
  };

  // --- Selection: bridge tanstack rowSelection <-> AntD rowSelection prop. ----
  const selectedKeys = (rowSelection?.selectedRowKeys ?? []) as Key[];
  const selectedKeysSig = selectedKeys.join("|");
  const rowSelectionState = useMemo<RowSelectionState>(() => {
    const m: RowSelectionState = {};
    for (const k of selectedKeys) m[String(k)] = true;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeysSig]);

  const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
    const next =
      typeof updater === "function" ? updater(rowSelectionState) : updater;
    const keys = Object.keys(next).filter((k) => next[k]);
    const byKey = new Map(rows.map((r, i) => [resolveRowKey(r, i), r]));
    const selectedRows = keys
      .map((k) => byKey.get(k))
      .filter((r): r is T => r != null);
    rowSelection?.onChange?.(keys as Key[], selectedRows, { type: "multiple" });
  };

  // --- AntD columns -> tanstack ColumnDefs. ----------------------------------
  const tanstackColumns = useMemo<ColumnDef<T>[]>(() => {
    return columns.map((col, i) => {
      const c = col as ColumnType<T>;
      const key = columnKey(c, i);
      return {
        id: key,
        accessorFn: (row: T) => readCell(row, c.dataIndex),
        enableSorting: !!c.sorter,
        header: () => c.title as React.ReactNode,
        cell: (ctx) => {
          const value = ctx.getValue();
          return (
            c.render
              ? c.render(value, ctx.row.original, ctx.row.index)
              : (value as React.ReactNode)
          ) as React.ReactNode;
        },
        meta: {
          antd: c,
          align: c.align,
          width: c.width,
          ellipsis: !!c.ellipsis,
        } as ColumnMeta<T>,
      } as ColumnDef<T>;
    });
  }, [columns]);

  const table = useReactTable<T>({
    data: rows,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: !!rowSelection,
    getRowId: resolveRowKey,
    state: { sorting, rowSelection: rowSelectionState },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
  });

  const selectable = !!rowSelection;
  const totalColSpan = tanstackColumns.length + (selectable ? 1 : 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const cellPad = size === "small" ? "py-2" : "";
  const minWidth =
    scroll?.x && scroll.x !== true ? scroll.x : undefined;

  const applyColumnFilter = (key: string, value: FilterValue | null) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    onFilterChange?.(next);
  };

  const headerGroups = table.getHeaderGroups();
  const modelRows = table.getRowModel().rows;
  const allSelected =
    selectable &&
    modelRows.length > 0 &&
    modelRows.every((r) => r.getIsSelected());
  const someSelected = selectable && modelRows.some((r) => r.getIsSelected());

  return (
    <div className="flex flex-col gap-4">
      {searchable && (
        <div className="relative max-w-sm">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            type="search"
            placeholder={t("search")}
            value={searchValue}
            onChange={(e) => handleSearch(e.target.value)}
            className="ps-9"
          />
        </div>
      )}

      <div className="relative overflow-x-auto rounded-md border border-border">
        <Table style={minWidth ? { minWidth } : undefined}>
          <TableHeader>
            {headerGroups.map((hg) => (
              <TableRow key={hg.id}>
                {selectable && (
                  <TableHead className="w-10">
                    <Checkbox
                      label={t("selectAll")}
                      checked={!!allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={(v) => table.toggleAllRowsSelected(v)}
                    />
                  </TableHead>
                )}
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | ColumnMeta<T>
                    | undefined;
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const colFilters = meta?.antd.filters;
                  return (
                    <TableHead
                      key={header.id}
                      style={meta?.width ? { width: meta.width } : undefined}
                      className={cn(
                        meta?.align === "center" && "text-center",
                        meta?.align === "right" && "text-end",
                      )}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        {canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1.5 rounded-sm font-semibold outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            <SortIcon dir={sorted} />
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                        {colFilters && colFilters.length > 0 && (
                          <ColumnFilter
                            columnId={header.column.id}
                            options={colFilters}
                            multiple={meta?.antd.filterMultiple !== false}
                            selected={filters[header.column.id] ?? null}
                            onApply={(v) =>
                              applyColumnFilter(header.column.id, v)
                            }
                            filterLabel={t("filter")}
                          />
                        )}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {modelRows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={totalColSpan}
                  className="py-12 text-center text-muted-foreground"
                >
                  {emptyText ?? t("noData")}
                </TableCell>
              </TableRow>
            ) : (
              modelRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-selected={row.getIsSelected() || undefined}
                >
                  {selectable && (
                    <TableCell className={cn("w-10", cellPad)}>
                      <Checkbox
                        label={t("selectRow")}
                        checked={row.getIsSelected()}
                        onChange={(v) => row.toggleSelected(v)}
                      />
                    </TableCell>
                  )}
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      | ColumnMeta<T>
                      | undefined;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cellPad,
                          meta?.align === "center" && "text-center",
                          meta?.align === "right" && "text-end",
                          meta?.ellipsis &&
                            "max-w-0 truncate whitespace-nowrap",
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/60">
            <span
              role="status"
              aria-label={t("loading")}
              className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary"
            />
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {rangeStart}-{rangeEnd} / {total}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="sr-only">{t("pageSize")}</span>
              <select
                value={pageSize}
                onChange={(e) => onPageChange?.(1, Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("pageSize")}
              >
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} / {t("page")}
                  </option>
                ))}
              </select>
            </label>
            <Pager
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              onPageChange={onPageChange}
              prevLabel={t("prevPage")}
              nextLabel={t("nextPage")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Column-header filter menu (radio for single-select, checkboxes for multi). */
function ColumnFilter({
  columnId,
  options,
  multiple,
  selected,
  onApply,
  filterLabel,
}: {
  columnId: string;
  options: NonNullable<ColumnType<unknown>["filters"]>;
  multiple: boolean;
  selected: FilterValue | null;
  onApply: (value: FilterValue | null) => void;
  filterLabel: string;
}) {
  const selectedSet = new Set((selected ?? []).map(String));
  const active = selectedSet.size > 0;
  const toggle = (value: string) => {
    if (multiple) {
      const next = new Set(selectedSet);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      onApply(next.size ? Array.from(next) : null);
    } else {
      onApply(selectedSet.has(value) ? null : [value]);
    }
  };
  return (
    <Popover>
      <PopoverTrigger
        aria-label={filterLabel}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "text-primary"
            : "text-muted-foreground/60 hover:text-foreground",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="currentColor"
          aria-hidden
        >
          <path d="M3 5h18l-7 8v6l-4-2v-4z" />
        </svg>
      </PopoverTrigger>
      <PopoverContent align="start" className="min-w-40">
        <ul className="flex flex-col" role="group" aria-label={filterLabel}>
          {options.map((opt) => {
            const value = String(opt.value);
            const checked = selectedSet.has(value);
            return (
              <li key={`${columnId}-${value}`}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-muted">
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name={`filter-${columnId}`}
                    checked={checked}
                    onChange={() => toggle(value)}
                    className="h-3.5 w-3.5 accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {opt.text}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Windowed numbered pager. Page buttons carry title={n} for stable targeting. */
function Pager({
  page,
  pageCount,
  pageSize,
  onPageChange,
  prevLabel,
  nextLabel,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange?: (page: number, pageSize: number) => void;
  prevLabel: string;
  nextLabel: string;
}) {
  const go = (p: number) => {
    if (p >= 1 && p <= pageCount && p !== page) onPageChange?.(p, pageSize);
  };
  // Window of up to 5 page numbers centred on the current page.
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);

  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-input px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none";

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <button
        type="button"
        className={btn}
        aria-label={prevLabel}
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        &lsaquo;
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          title={String(p)}
          aria-label={`${p}`}
          aria-current={p === page ? "page" : undefined}
          onClick={() => go(p)}
          className={cn(
            btn,
            p === page &&
              "border-primary bg-primary text-primary-foreground",
          )}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className={btn}
        aria-label={nextLabel}
        disabled={page >= pageCount}
        onClick={() => go(page + 1)}
      >
        &rsaquo;
      </button>
    </nav>
  );
}
