"use client";

import { Descriptions } from "antd";
import type { DescriptionsProps } from "antd";
import type { ReactNode } from "react";

export interface DescriptionItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Column span for this row (AntD Descriptions item span). */
  span?: number;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
  /** Columns at the widest breakpoint (responsive object handled internally). */
  columns?: number;
  bordered?: boolean;
  title?: ReactNode;
  size?: DescriptionsProps["size"];
}

/**
 * Key/value detail view — the one "show a record's fields" pattern, on AntD
 * Descriptions with sensible responsive columns. Use for entity detail panes so
 * read-only record views look consistent instead of hand-rolled label/value grids.
 */
export function DescriptionList({
  items,
  columns = 2,
  bordered = true,
  title,
  size = "middle",
}: DescriptionListProps) {
  return (
    <Descriptions
      title={title}
      bordered={bordered}
      size={size}
      // Collapse to a single column on narrow screens, the requested count above.
      column={{ xs: 1, sm: 1, md: columns, lg: columns, xl: columns, xxl: columns }}
      items={items.map((it) => ({
        key: it.key,
        label: it.label,
        children: it.value,
        span: it.span,
      }))}
    />
  );
}
