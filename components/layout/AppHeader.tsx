"use client";

import { Layout, Space, Dropdown, Avatar, Button, Typography, theme } from "antd";
import {
  UserOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  GlobalOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { OrgSwitcher } from "./OrgSwitcher";
import { NotificationsMenu } from "./NotificationsMenu";
import { OPEN_COMMAND_PALETTE } from "./CommandPalette";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "./ThemeProvider";
import {
  hasMultipleLocales,
  localePrefixRegex,
  nextLocale,
} from "@/i18n/config";

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
  const tChrome = useTranslations("chrome");
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
      <OrgSwitcher />

      <Space size="middle">
        <Button
          icon={<SearchOutlined />}
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
          aria-label={tChrome("openCommand")}
          style={{
            color: token.colorTextSecondary,
            paddingInline: 12,
            justifyContent: "flex-start",
            gap: 8,
          }}
        >
          <span className="header-search-label">{tChrome("search")}</span>
          <kbd className="header-search-kbd">⌘K</kbd>
        </Button>

        <NotificationsMenu />

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
