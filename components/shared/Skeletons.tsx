"use client";

import { Skeleton, Flex, Space } from "antd";

/**
 * Layout-matched loading states. A loading screen should be the *silhouette* of
 * the screen that's coming, not a centered spinner or a generic grey block — so
 * content doesn't jump when it arrives and the user sees structure immediately.
 *
 * Every skeleton's header mirrors <PageHeader> (title block inline-start,
 * optional action inline-end, the same var(--space-4) bottom gap), so the page
 * keeps its shape across the load. Use these in route loading.tsx files AND in
 * in-component `if (loading) …` returns instead of <Spin/>.
 */

function HeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <Flex
      align="flex-start"
      justify="space-between"
      gap="middle"
      style={{ marginBottom: "var(--space-4)" }}
    >
      <Skeleton.Input active style={{ width: 180 }} />
      {withAction ? <Skeleton.Button active style={{ width: 120 }} /> : null}
    </Flex>
  );
}

/** Generic page: header + N paragraph rows. The catch-all (route loading.tsx). */
export function PageSkeleton({
  rows = 6,
  withAction = false,
}: {
  rows?: number;
  withAction?: boolean;
}) {
  return (
    <div>
      <HeaderSkeleton withAction={withAction} />
      <Skeleton active paragraph={{ rows }} />
    </div>
  );
}

/** A list screen: header + primary action + table-shaped rows. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <HeaderSkeleton withAction />
      <Skeleton active title={false} paragraph={{ rows }} />
    </div>
  );
}

/** A form screen: header + stacked field rows + submit button. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div>
      <HeaderSkeleton />
      <Space
        orientation="vertical"
        size="large"
        style={{ width: "100%", maxWidth: 480 }}
      >
        {Array.from({ length: fields }).map((_, i) => (
          <Skeleton.Input key={i} active block style={{ height: 40 }} />
        ))}
        <Skeleton.Button active style={{ width: 120 }} />
      </Space>
    </div>
  );
}
