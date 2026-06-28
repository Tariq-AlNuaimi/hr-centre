"use client";

import { Flex, Space, Typography } from "antd";

const { Title, Paragraph } = Typography;

interface PageHeaderProps {
  /** The page heading. Renders as an <h{level}> for correct heading order. */
  title: React.ReactNode;
  /** Optional muted line under the title (one sentence — what this screen is for). */
  subtitle?: React.ReactNode;
  /** Inline-end slot — the screen's ONE primary action (+ at most one secondary).
   *  RTL-mirrors automatically (Flex respects `dir`). */
  actions?: React.ReactNode;
  /** Heading level. Default 2 (a page's top heading; the app name is the h1). */
  level?: 1 | 2 | 3 | 4 | 5;
}

/**
 * The one page-title pattern for the whole app: heading + optional subtitle on
 * the inline-start, the primary action on the inline-end, consistent on-token
 * spacing below. Replaces the hand-rolled `Space + Title + Button` blocks (each
 * with its own ad-hoc `marginBottom`) so every screen's header reads the same —
 * the consistency the design-QA rubric scores (docs/uat-rubric.md, Tier 1).
 *
 * One primary action per header (Tier-0 anti-slop rule): pass a single
 * `type="primary"` button in `actions`; additional buttons stay default/text.
 */
export function PageHeader({ title, subtitle, actions, level = 2 }: PageHeaderProps) {
  return (
    <Flex
      align="flex-start"
      justify="space-between"
      gap="middle"
      wrap
      style={{ marginBottom: "var(--space-4)" }}
    >
      <div>
        <Title level={level} style={{ margin: 0 }}>
          {title}
        </Title>
        {subtitle ? (
          <Paragraph type="secondary" style={{ margin: 0, marginTop: "var(--space-1)" }}>
            {subtitle}
          </Paragraph>
        ) : null}
      </div>
      {actions ? <Space wrap>{actions}</Space> : null}
    </Flex>
  );
}
