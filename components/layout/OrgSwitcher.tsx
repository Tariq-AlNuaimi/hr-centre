"use client";

import { Dropdown, Typography, theme } from "antd";
import { DownOutlined, CheckOutlined } from "@ant-design/icons";
import { useTranslations } from "next-intl";
import type { MenuProps } from "antd";
import { brand } from "@/brand.config";

const { Text } = Typography;

/**
 * Workspace / org switcher (top-left chrome). The template is single-tenant, so
 * this shows the one brand workspace with an honest "only workspace" hint rather
 * than faking tenants. A multi-tenant fork feeds real orgs into the menu and
 * wires selection — the control + interaction model are already here.
 */
export function OrgSwitcher() {
  const t = useTranslations("chrome");
  const { token } = theme.useToken();

  const items: MenuProps["items"] = [
    {
      key: "current",
      icon: <CheckOutlined style={{ color: token.colorPrimary }} />,
      label: brand.appName,
    },
    { type: "divider" },
    {
      key: "hint",
      disabled: true,
      label: (
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("singleWorkspaceHint")}
        </Text>
      ),
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={["click"]} placement="bottomLeft">
      <button
        type="button"
        aria-label={t("switchWorkspace")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: `4px 8px`,
          border: "none",
          background: "transparent",
          borderRadius: token.borderRadius,
          cursor: "pointer",
          color: token.colorText,
          fontFamily: "inherit",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            inlineSize: 28,
            blockSize: 28,
            borderRadius: token.borderRadius,
            background: token.colorPrimary,
            color: token.colorTextLightSolid,
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {brand.monogram}
        </span>
        <Text strong style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
          {brand.appName}
        </Text>
        <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary }} />
      </button>
    </Dropdown>
  );
}
