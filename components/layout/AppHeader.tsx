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
import {
  hasMultipleLocales,
  localePrefixRegex,
  nextLocale,
} from "@/i18n/config";
import { brand } from "@/brand.config";

// Native names for the locales we ship; falls back to the uppercased code so an
// unmapped locale still gets a sensible switcher label.
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  ar: "العربية",
};

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

  const target = nextLocale(currentLocale);
  const switchLocale = () => {
    const newPath = pathname.replace(localePrefixRegex, `/${target}`);
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
      <Space
        size={10}
        style={{ cursor: "pointer" }}
        onClick={() => router.push(`/${currentLocale}`)}
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
        <Text strong style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
          {brand.appName}
        </Text>
      </Space>

      <Space size="middle">
        {hasMultipleLocales && (
          <Button
            type="text"
            icon={<GlobalOutlined />}
            onClick={switchLocale}
            title={LOCALE_LABELS[target] ?? target.toUpperCase()}
          >
            {target.toUpperCase()}
          </Button>
        )}

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
