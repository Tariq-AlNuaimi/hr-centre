"use client";

import { Card, Flex, Space, Typography, theme } from "antd";
import type { ReactNode } from "react";

const { Title, Text } = Typography;

export interface SectionCardProps {
  /** Section heading. */
  title: ReactNode;
  /** Optional one-line description under the title. */
  subtitle?: ReactNode;
  /** Inline-end slot for the section's actions (RTL-mirrors automatically). */
  actions?: ReactNode;
  /** Remove body padding (e.g. when embedding a full-bleed Table). */
  noBodyPadding?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
}

/**
 * A titled content panel — heading + optional subtitle on the inline-start,
 * actions on the inline-end, a divider, then content. The one "card with a
 * header" pattern so sections read consistently (vs ad-hoc `Card title={}`
 * with no room for a subtitle or actions). Builds on AntD Card + the theme.
 */
export function SectionCard({
  title,
  subtitle,
  actions,
  noBodyPadding,
  children,
  style,
}: SectionCardProps) {
  const { token } = theme.useToken();

  return (
    <Card styles={{ body: { padding: 0 } }} style={style}>
      <Flex
        align="flex-start"
        justify="space-between"
        gap="middle"
        wrap
        style={{
          padding: `${token.paddingSM}px ${token.paddingLG}px`,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div>
          <Title level={5} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle && (
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {subtitle}
            </Text>
          )}
        </div>
        {actions && <Space wrap>{actions}</Space>}
      </Flex>
      <div style={{ padding: noBodyPadding ? 0 : token.paddingLG }}>{children}</div>
    </Card>
  );
}
