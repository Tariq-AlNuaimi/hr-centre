"use client";

import { Layout, Space, Dropdown, Avatar, Button, Typography, theme } from "antd";
import {
  UserOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "./ThemeProvider";

const { Header } = Layout;
const { Text } = Typography;

export function AppHeader() {
  const t = useTranslations("nav");
  const tTheme = useTranslations("theme");
  const { data: session } = useSession();
  const { isDark, setMode } = useTheme();
  const { token } = theme.useToken();
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const switchLocale = () => {
    const newLocale = currentLocale === "en" ? "ar" : "en";
    const newPath = pathname.replace(/^\/(en|ar)/, `/${newLocale}`);
    router.push(newPath);
  };

  const userMenuItems = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: t("profile"),
      onClick: () => router.push(`/${currentLocale}/settings/profile`),
    },
    { type: "divider" as const },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: t("logout"),
      onClick: () => signOut({ callbackUrl: `/${currentLocale}/login` }),
    },
  ];

  return (
    <Header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <Text strong style={{ fontSize: 18 }}>
        {process.env.NEXT_PUBLIC_APP_NAME ?? "My App"}
      </Text>

      <Space size="middle">
        <Button
          type="text"
          icon={<GlobalOutlined />}
          onClick={switchLocale}
          title={currentLocale === "en" ? "العربية" : "English"}
        >
          {currentLocale === "en" ? "AR" : "EN"}
        </Button>

        <Button
          type="text"
          icon={isDark ? <SunOutlined /> : <MoonOutlined />}
          onClick={() => setMode(isDark ? "light" : "dark")}
          title={isDark ? tTheme("light") : tTheme("dark")}
          aria-label={tTheme("toggle")}
        />

        <Dropdown menu={{ items: userMenuItems }} trigger={["click"]}>
          <Space style={{ cursor: "pointer" }}>
            <Avatar icon={<UserOutlined />} src={session?.user?.image} />
            <Text>{session?.user?.name ?? session?.user?.email}</Text>
          </Space>
        </Dropdown>
      </Space>
    </Header>
  );
}
