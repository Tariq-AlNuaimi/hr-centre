"use client";

import { Flex, Space } from "antd";
import type { ReactNode } from "react";

export interface ToolbarProps {
  /** Inline-start slot — search, filters, view controls. */
  start?: ReactNode;
  /** Inline-end slot — the primary + secondary actions. */
  end?: ReactNode;
}

/**
 * A list/section action bar: filters/search on the inline-start, actions on the
 * inline-end, wrapping + RTL-correct. The one toolbar pattern so list screens
 * don't each hand-roll a flex row with ad-hoc spacing.
 */
export function Toolbar({ start, end }: ToolbarProps) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap="middle"
      wrap
      style={{ marginBottom: "var(--space-3)" }}
    >
      <Space wrap>{start}</Space>
      {end && <Space wrap>{end}</Space>}
    </Flex>
  );
}
