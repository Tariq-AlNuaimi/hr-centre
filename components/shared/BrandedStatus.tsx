"use client";

import { Space, Typography, theme } from "antd";
import type { ReactNode } from "react";
import { brand } from "@/brand.config";

const { Title, Paragraph } = Typography;

/**
 * One branded surface for every "status" screen — 404 / 403 / 500 / maintenance.
 * Centered brand mark + headline + supporting copy + actions, on-token in both
 * modes. Reusing one primitive keeps these pages consistent and rebrandable
 * from brand.config (the /design-system "build on the shared primitive" rule).
 */
export function BrandedStatus({
  code,
  title,
  subtitle,
  icon,
  actions,
  minHeight = "70vh",
}: {
  /** Large status code (e.g. "404"); omit for icon-led screens. */
  code?: string;
  title: string;
  subtitle?: string;
  /** Optional icon shown in the brand chip instead of the monogram. */
  icon?: ReactNode;
  actions?: ReactNode;
  minHeight?: string | number;
}) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--density-page)",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            inlineSize: 56,
            blockSize: 56,
            borderRadius: token.borderRadiusLG,
            background: token.colorPrimary,
            color: token.colorTextLightSolid,
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1,
            marginBlockEnd: token.marginLG,
            boxShadow: token.boxShadowSecondary,
          }}
        >
          {icon ?? brand.monogram}
        </span>

        {code && (
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: token.colorTextHeading,
              marginBlockEnd: token.marginXS,
            }}
          >
            {code}
          </div>
        )}

        <Title level={3} style={{ marginBlockEnd: token.marginXS }}>
          {title}
        </Title>

        {subtitle && (
          <Paragraph type="secondary" style={{ marginBlockEnd: token.marginLG }}>
            {subtitle}
          </Paragraph>
        )}

        {actions && (
          <Space size="middle" wrap style={{ justifyContent: "center" }}>
            {actions}
          </Space>
        )}
      </div>
    </div>
  );
}
