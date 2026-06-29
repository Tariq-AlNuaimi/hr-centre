"use client";

import { Modal, Input, Empty, theme } from "antd";
import {
  HomeOutlined,
  UserOutlined,
  AuditOutlined,
  DeleteOutlined,
  SettingOutlined,
  BulbOutlined,
  LogoutOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "./ThemeProvider";

// Custom event the header search button dispatches to open the palette without
// a shared context (keeps the trigger decoupled from the modal mount point).
export const OPEN_COMMAND_PALETTE = "open-command-palette";

type Command = {
  key: string;
  label: string;
  group: "navigate" | "actions";
  icon: React.ReactNode;
  run: () => void;
  keywords?: string;
};

/**
 * ⌘K / Ctrl+K command palette + global search. Mounted once in AppShell; opens
 * on the shortcut OR an OPEN_COMMAND_PALETTE window event (the header button).
 * Searches navigation destinations + quick actions, role-aware. Fully
 * keyboard-driven (↑/↓ to move, Enter to run, Esc to close).
 */
export function CommandPalette() {
  const t = useTranslations("chrome");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const { isDark, setMode } = useTheme();
  const { token } = theme.useToken();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const isAdmin = session?.user?.role === "ADMIN";

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (path: string) => {
      router.push(path);
      close();
    },
    [router, close],
  );

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { key: "home", label: tNav("home"), group: "navigate", icon: <HomeOutlined />, run: () => go(`/${locale}`) },
      ...(isAdmin
        ? [
            { key: "users", label: tNav("users"), group: "navigate" as const, icon: <UserOutlined />, run: () => go(`/${locale}/users`) },
            { key: "audit-log", label: tNav("auditLog"), group: "navigate" as const, icon: <AuditOutlined />, run: () => go(`/${locale}/audit-log`) },
            { key: "recycling-bin", label: tNav("recyclingBin"), group: "navigate" as const, icon: <DeleteOutlined />, run: () => go(`/${locale}/recycling-bin`) },
          ]
        : []),
      { key: "settings", label: tNav("settings"), group: "navigate", icon: <SettingOutlined />, run: () => go(`/${locale}/settings`) },
      { key: "profile", label: tNav("profile"), group: "navigate", icon: <UserOutlined />, run: () => go(`/${locale}/settings/profile`) },
    ];
    const actions: Command[] = [
      { key: "toggle-theme", label: t("actionToggleTheme"), group: "actions", icon: <BulbOutlined />, run: () => { setMode(isDark ? "light" : "dark"); close(); } },
      { key: "logout", label: t("actionLogout"), group: "actions", icon: <LogoutOutlined />, run: () => signOut({ callbackUrl: `/${locale}/login` }) },
    ];
    return [...nav, ...actions];
  }, [tNav, t, locale, isAdmin, go, setMode, isDark, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords?.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Clamp during render (not an effect) so the highlight stays in range as the
  // filtered list shrinks — no cascading-render setState.
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));

  // Global open shortcut + the header-button event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen);
    };
  }, []);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIndex]?.run();
    }
  };

  const groups: { id: Command["group"]; label: string }[] = [
    { id: "navigate", label: t("groupNavigate") },
    { id: "actions", label: t("groupActions") },
  ];

  // A stable, flat index across groups so ↑/↓ highlight maps to `filtered`.
  let runningIndex = -1;

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      closable={false}
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
      width={560}
    >
      <div onKeyDown={onListKeyDown}>
        <Input
          autoFocus
          size="large"
          variant="borderless"
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder={t("commandPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          style={{ borderBottom: `1px solid ${token.colorBorderSecondary}`, paddingBlock: 14 }}
        />

        <div style={{ maxHeight: 360, overflowY: "auto", padding: token.paddingXS }}>
          {filtered.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("noResults")}
              style={{ paddingBlock: token.paddingLG }}
            />
          )}

          {groups.map((g) => {
            const items = filtered.filter((c) => c.group === g.id);
            if (items.length === 0) return null;
            return (
              <div key={g.id} style={{ marginBlockEnd: token.marginXS }}>
                <div
                  style={{
                    padding: `${token.paddingXXS}px ${token.paddingSM}px`,
                    fontSize: token.fontSizeSM,
                    color: token.colorTextTertiary,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {g.label}
                </div>
                {items.map((c) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => c.run()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: token.marginSM,
                        inlineSize: "100%",
                        textAlign: "start",
                        padding: `${token.paddingSM}px ${token.paddingSM}px`,
                        borderRadius: token.borderRadius,
                        border: "none",
                        cursor: "pointer",
                        background: isActive ? token.controlItemBgHover : "transparent",
                        color: token.colorText,
                        fontSize: token.fontSize,
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ color: token.colorTextSecondary, display: "inline-flex" }}>
                        {c.icon}
                      </span>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
