"use client";

import { Card, Typography, theme } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

const { Text } = Typography;

export interface StatCardProps {
  /** Metric label (e.g. "Total users"). */
  title: ReactNode;
  /** The headline value. */
  value: ReactNode;
  /** Optional leading icon, shown in a tinted brand chip. */
  icon?: ReactNode;
  /** Optional trend: positive = up (good by default), negative = down. */
  trend?: { value: number; direction: "up" | "down"; positiveIsGood?: boolean };
  /** Optional muted line under the value (context for the number). */
  hint?: ReactNode;
}

/**
 * Branded KPI card — the one stat surface for the app. A tinted brand chip for
 * the icon, a large value, and an optional trend pill with semantic color.
 * Replaces the bare `Card + Statistic` so every metric reads consistently
 * (the /design-system "build on a shared primitive" rule).
 */
export function StatCard({ title, value, icon, trend, hint }: StatCardProps) {
  const { token } = theme.useToken();
  const t = useTranslations("data");

  const trendUp = trend?.direction === "up";
  const positiveIsGood = trend?.positiveIsGood ?? true;
  // "Good" = up when up is good, or down when down is good.
  const isGood = trendUp === positiveIsGood;
  const trendColor = isGood ? token.colorSuccess : token.colorError;

  return (
    <Card styles={{ body: { padding: token.paddingLG } }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: token.marginSM }}>
        {icon && (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              inlineSize: 40,
              blockSize: 40,
              flex: "none",
              borderRadius: token.borderRadius,
              background: token.colorPrimaryBg,
              color: token.colorPrimary,
              fontSize: 18,
            }}
          >
            {icon}
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text type="secondary" style={{ fontSize: token.fontSize }}>
            {title}
          </Text>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: token.marginSM,
              marginBlockStart: token.marginXXS,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
                color: token.colorTextHeading,
              }}
            >
              {value}
            </span>
            {trend && (
              <span
                aria-label={
                  trendUp
                    ? t("trendUp", { value: Math.abs(trend.value) })
                    : t("trendDown", { value: Math.abs(trend.value) })
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: token.marginXXS,
                  fontSize: token.fontSizeSM,
                  fontWeight: 600,
                  color: trendColor,
                }}
              >
                <span aria-hidden>
                  {trendUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                </span>
                {Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {hint && (
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {hint}
            </Text>
          )}
        </div>
      </div>
    </Card>
  );
}
