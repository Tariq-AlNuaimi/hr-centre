"use client";

import { Layout, Menu } from "antd";
import {
  HomeOutlined,
  UserOutlined,
  SettingOutlined,
  DeleteOutlined,
  AuditOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

const { Sider } = Layout;

export function AppSidebar() {
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  // types/index.ts augments next-auth's Session.user with role: Role,
  // so this access is typed -- no `as any` needed.
  const isAdmin = session?.user?.role === "ADMIN";

  // Strip locale prefix for active key matching
  const activeKey =
    pathname
      .replace(/^\/(en|ar)/, "")
      .split("/")
      .filter(Boolean)[0] ?? "home";

  const menuItems = [
    {
      key: "home",
      icon: <HomeOutlined />,
      label: t("home"),
      onClick: () => router.push(`/${locale}`),
    },
    {
      key: "assessments",
      icon: <ThunderboltOutlined />,
      label: t("assessments"),
      onClick: () => router.push(`/${locale}/assessments`),
    },
    ...(isAdmin
      ? [
          {
            key: "users",
            icon: <UserOutlined />,
            label: t("users"),
            onClick: () => router.push(`/${locale}/users`),
          },
          {
            key: "audit-log",
            icon: <AuditOutlined />,
            label: t("auditLog"),
            onClick: () => router.push(`/${locale}/audit-log`),
          },
        ]
      : []),
    {
      key: "recycling-bin",
      icon: <DeleteOutlined />,
      label: t("recyclingBin"),
      onClick: () => router.push(`/${locale}/recycling-bin`),
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: t("settings"),
      onClick: () => router.push(`/${locale}/settings`),
    },
    // NOTE: scaffolded entity nav entries are inserted before the recycling-bin
    // item above (see scripts/scaffold-entity.mjs patchSidebar marker) -- keep
    // that literal intact.
  ].filter((item) => item.key !== "recycling-bin" || isAdmin); // bin is admin-only (API is withAdminAuth)

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      breakpoint="lg"
      style={{ borderInlineEnd: "1px solid" }}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems}
          style={{ flex: 1, borderRight: 0 }}
        />
      </div>
    </Sider>
  );
}
