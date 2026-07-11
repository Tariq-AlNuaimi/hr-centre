import type { Key as ReactKey, ReactNode } from "react";

/**
 * Local table type surface (ADR-029, Workstream C4 — final AntD removal).
 *
 * These model the exact subset of Ant Design's `Table` / `Column` types that the
 * rebuilt `DataTable`/`DataView` (and the screens that author columns for them)
 * consume, so the shared table primitives keep the same authoring shape after
 * `antd` is uninstalled. It is a **type-only** module — no runtime code — and is
 * deliberately NOT a full AntD type port: only the props the primitives actually
 * read are modeled. `DataTable` converts these AntD-shaped columns into
 * @tanstack/react-table `ColumnDef`s internally.
 */

/** A stable row / column key. Mirrors AntD's `Key` (React.Key). */
export type Key = ReactKey;

/** An applied column-filter selection. Mirrors AntD's `FilterValue`. */
export type FilterValue = (Key | boolean)[];

/** One option in a column's filter menu (AntD `ColumnFilterItem` subset). */
export interface ColumnFilterItem {
  text: ReactNode;
  value: Key | boolean;
}

/**
 * A single list-table column, in the AntD-shaped authoring form the DataTable
 * converts to a @tanstack/react-table `ColumnDef` at runtime. `render`'s value
 * is `any` — matching AntD's own `ColumnType.render` — so existing call sites
 * that narrow it (e.g. `render: (role: string) => …`) keep compiling.
 */
export interface ColumnType<T> {
  key?: Key;
  dataIndex?: string | number | readonly (string | number)[];
  title?: ReactNode;
  align?: "left" | "center" | "right";
  width?: string | number;
  ellipsis?: boolean;
  /** Truthy → the column is sortable (server-driven via `onSortChange`). */
  sorter?: boolean | ((a: T, b: T) => number);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AntD parity: value is untyped so narrowed call-site renders assign cleanly.
  render?: (value: any, record: T, index: number) => ReactNode;
  filters?: ColumnFilterItem[];
  filterMultiple?: boolean;
}

/** An ordered list of columns. Mirrors AntD's `ColumnsType`. */
export type ColumnsType<T> = ColumnType<T>[];

/** How a selection change was triggered (AntD `RowSelectMethod` subset). */
export type RowSelectMethod = "all" | "none" | "invert" | "single" | "multiple";

/** Row-selection config. Mirrors the AntD `rowSelection` subset used here. */
export interface TableRowSelection<T> {
  selectedRowKeys?: Key[];
  onChange?: (selectedRowKeys: Key[], selectedRows: T[], info: { type: RowSelectMethod }) => void;
  preserveSelectedRowKeys?: boolean;
  type?: "checkbox" | "radio";
}

/** The DataTable / DataView prop surface (AntD `TableProps` subset). */
export interface TableProps<T> {
  columns?: ColumnsType<T>;
  dataSource?: readonly T[];
  rowKey?: string | ((record: T) => Key);
  loading?: boolean;
  rowSelection?: TableRowSelection<T>;
  scroll?: { x?: number | string | true; y?: number | string };
  size?: "small" | "middle" | "large";
}
